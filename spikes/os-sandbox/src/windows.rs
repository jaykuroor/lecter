//! Windows: the parent starts the child suspended in an AppContainer with no capabilities, puts it in
//! a job object (1 GiB process memory, one active process, killed when the job closes), then resumes it.
//!
//! An AppContainer has no network without the `internetClient` / `privateNetworkClientServer`
//! capabilities (loopback included). It is a Less Privileged AppContainer (LPAC): it opens a file
//! only if the file's ACL names the container SID or ALL RESTRICTED APPLICATION PACKAGES, not
//! ALL APPLICATION PACKAGES. The parent grants the container read/execute on the child's executable
//! only. The input is never granted: the parent opens it read-only and the child inherits exactly
//! that one handle (PROC_THREAD_ATTRIBUTE_HANDLE_LIST), so a later run can't open it by path.
//! The worker's IPC pipes must be passed the same way, never by bInheritHandles = TRUE alone.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Win32::Foundation::{
    CloseHandle, GENERIC_EXECUTE, GENERIC_READ, HANDLE, HANDLE_FLAG_INHERIT, LocalFree, SetHandleInformation,
    WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::Authorization::{
    EXPLICIT_ACCESS_W, GRANT_ACCESS, GetNamedSecurityInfoW, NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT, SetEntriesInAclW,
    SetNamedSecurityInfoW, TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP, TRUSTEE_W,
};
use windows_sys::Win32::Security::Isolation::{CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName};
use windows_sys::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, FreeSid, NO_INHERITANCE, PSECURITY_DESCRIPTOR, PSID, SECURITY_CAPABILITIES,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CreateProcessW, DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT,
    GetExitCodeProcess, InitializeProcThreadAttributeList, PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
    PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION, ResumeThread,
    STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
};

use crate::launch::{Outcome, sandboxed_args};
use crate::probe::INPUT_HANDLE_FLAG;
use crate::{Error, MEMORY_LIMIT_BYTES};

/// One container for every spike run: a fixed name keeps the one ACE (on the probe exe) to one SID.
const CONTAINER_NAME: &str = "lecter.spike.os-sandbox";
/// HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS).
const HRESULT_ALREADY_EXISTS: i32 = 0x8007_00B7_u32 as i32;
/// How long a probe may run before the parent kills it.
const WAIT_MS: u32 = 120_000;
/// Attributes on the child: security capabilities, the LPAC policy, the inherited handle list.
const ATTRIBUTES: u32 = 3;
/// `PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT` (winbase.h).
const PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT: u32 = 1;

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

/// Quotes one argument the way `CommandLineToArgvW` and the MSVC runtime parse it.
fn quote(arg: &OsStr, out: &mut Vec<u16>) {
    let units: Vec<u16> = arg.encode_wide().collect();
    let needs = units.is_empty() || units.iter().any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'"' as u16);
    if !needs {
        out.extend_from_slice(&units);
        return;
    }
    out.push(b'"' as u16);
    let mut backslashes = 0usize;
    for &c in &units {
        if c == b'\\' as u16 {
            backslashes += 1;
        } else {
            if c == b'"' as u16 {
                out.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2 + 1));
            } else {
                out.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
            }
            backslashes = 0;
            out.push(c);
        }
    }
    out.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2));
    out.push(b'"' as u16);
}

struct Sid(PSID);
impl Drop for Sid {
    fn drop(&mut self) {
        // SAFETY: the SID came from CreateAppContainerProfile / Derive…, which require FreeSid.
        unsafe { FreeSid(self.0) };
    }
}

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the handle is owned by this guard and closed once.
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// A PROC_THREAD_ATTRIBUTE_LIST in a usize-aligned buffer.
struct AttrList(Vec<usize>);
impl AttrList {
    fn ptr(&mut self) -> *mut core::ffi::c_void {
        self.0.as_mut_ptr().cast()
    }
}
impl AttrList {
    /// Adds one attribute.
    ///
    /// # Safety
    /// `value` must point at `size` readable bytes that outlive the process creation.
    unsafe fn set(&mut self, attribute: u32, value: *const core::ffi::c_void, size: usize) -> Result<(), Error> {
        // SAFETY: the list is initialised; the caller guarantees `value`.
        let ok = unsafe {
            UpdateProcThreadAttribute(
                self.ptr(),
                0,
                attribute as usize,
                value,
                size,
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if ok == 0 {
            return Err(Error::last_os("UpdateProcThreadAttribute"));
        }
        Ok(())
    }
}
impl Drop for AttrList {
    fn drop(&mut self) {
        // SAFETY: the list was initialised by InitializeProcThreadAttributeList.
        unsafe { DeleteProcThreadAttributeList(self.ptr()) };
    }
}

fn container_sid() -> Result<Sid, Error> {
    let name = wide(OsStr::new(CONTAINER_NAME));
    let mut sid: PSID = std::ptr::null_mut();
    // SAFETY: all strings are NUL-terminated; no capabilities; `sid` receives a SID to FreeSid.
    let hr = unsafe {
        CreateAppContainerProfile(name.as_ptr(), name.as_ptr(), name.as_ptr(), std::ptr::null(), 0, &mut sid)
    };
    if hr == HRESULT_ALREADY_EXISTS {
        // SAFETY: as above.
        let hr = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
        if hr != 0 {
            return Err(Error::other("DeriveAppContainerSidFromAppContainerName", format!("HRESULT {hr:#x}")));
        }
    } else if hr != 0 {
        return Err(Error::other("CreateAppContainerProfile", format!("HRESULT {hr:#x}")));
    }
    Ok(Sid(sid))
}

/// Adds an allow ACE for `sid` with `access` to the file's DACL.
fn grant(path: &Path, sid: &Sid, access: u32) -> Result<(), Error> {
    let name = wide(path.as_os_str());
    let mut old_dacl: *mut ACL = std::ptr::null_mut();
    let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: `name` is NUL-terminated; out pointers are valid; `sd` is freed with LocalFree.
    let rc = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_dacl,
            std::ptr::null_mut(),
            &mut sd,
        )
    };
    if rc != 0 {
        return Err(Error::new("GetNamedSecurityInfoW", std::io::Error::from_raw_os_error(rc as i32)));
    }
    let ea = EXPLICIT_ACCESS_W {
        grfAccessPermissions: access,
        grfAccessMode: GRANT_ACCESS,
        grfInheritance: NO_INHERITANCE,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP,
            ptstrName: sid.0.cast(),
        },
    };
    let mut new_dacl: *mut ACL = std::ptr::null_mut();
    // SAFETY: one valid entry; `old_dacl` points into `sd`; `new_dacl` is freed with LocalFree.
    let rc = unsafe { SetEntriesInAclW(1, &ea, old_dacl, &mut new_dacl) };
    let result = if rc != 0 {
        Err(Error::new("SetEntriesInAclW", std::io::Error::from_raw_os_error(rc as i32)))
    } else {
        // SAFETY: `name` is NUL-terminated and `new_dacl` a valid ACL.
        let rc = unsafe {
            SetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                new_dacl,
                std::ptr::null(),
            )
        };
        if rc != 0 {
            Err(Error::new("SetNamedSecurityInfoW", std::io::Error::from_raw_os_error(rc as i32)))
        } else {
            Ok(())
        }
    };
    // SAFETY: both were allocated by the system with LocalAlloc; null is allowed.
    unsafe {
        LocalFree(new_dacl.cast());
        LocalFree(sd);
    }
    result
}

fn job() -> Result<Handle, Error> {
    // SAFETY: default security, unnamed job.
    let job = Handle(unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) });
    if job.0.is_null() {
        return Err(Error::last_os("CreateJobObjectW"));
    }
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    info.BasicLimitInformation.ActiveProcessLimit = 1;
    info.ProcessMemoryLimit = MEMORY_LIMIT_BYTES as usize;
    // SAFETY: `info` is a JOBOBJECT_EXTENDED_LIMIT_INFORMATION of the given size.
    let ok = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        return Err(Error::last_os("SetInformationJobObject"));
    }
    Ok(job)
}

/// Runs `exe --sandbox <input> <args>` in the AppContainer and job; waits up to two minutes.
pub fn run(exe: &Path, input: &Path, args: &[&OsStr]) -> Result<Outcome, Error> {
    let sid = container_sid()?;
    grant(exe, &sid, GENERIC_READ | GENERIC_EXECUTE)?;
    let job = job()?;

    // The input is opened here, read-only, and only this handle is inherited (HANDLE_LIST). No ACE
    // is added to the file, so no later run (same container) can open it by path.
    let file = std::fs::File::open(input).map_err(|e| Error::new("open input", e))?;
    let input_handle: HANDLE = file.as_raw_handle();
    // SAFETY: a valid handle owned by `file`.
    if unsafe { SetHandleInformation(input_handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0 {
        return Err(Error::last_os("SetHandleInformation"));
    }
    let inherited: [HANDLE; 1] = [input_handle];

    let mut size = 0usize;
    // SAFETY: size query with a null list; it fails with ERROR_INSUFFICIENT_BUFFER and sets `size`.
    unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), ATTRIBUTES, 0, &mut size) };
    let mut buf = vec![0usize; size.div_ceil(size_of::<usize>())];
    // SAFETY: `buf` holds at least `size` bytes.
    if unsafe { InitializeProcThreadAttributeList(buf.as_mut_ptr().cast(), ATTRIBUTES, 0, &mut size) } == 0 {
        return Err(Error::last_os("InitializeProcThreadAttributeList"));
    }
    let mut attrs = AttrList(buf);
    let caps = SECURITY_CAPABILITIES {
        AppContainerSid: sid.0,
        Capabilities: std::ptr::null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };
    // Less Privileged AppContainer: ALL APPLICATION PACKAGES grants no longer apply.
    let lpac: u32 = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
    // SAFETY (all three): each value outlives CreateProcessW below; the list has room for three.
    unsafe {
        attrs.set(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, (&raw const caps).cast(), size_of_val(&caps))?;
        attrs.set(
            PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
            (&raw const lpac).cast(),
            size_of_val(&lpac),
        )?;
        attrs.set(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited.as_ptr().cast(), size_of_val(&inherited))?;
    }

    let handle_arg = (input_handle as usize).to_string();
    let mut child_args = sandboxed_args(input, &[]);
    child_args.push(OsStr::new(INPUT_HANDLE_FLAG));
    child_args.push(OsStr::new(&handle_arg));
    child_args.extend_from_slice(args);
    let mut cmdline = Vec::new();
    quote(exe.as_os_str(), &mut cmdline);
    for a in child_args {
        cmdline.push(b' ' as u16);
        quote(a, &mut cmdline);
    }
    cmdline.push(0);
    let app = wide(exe.as_os_str());
    let mut si = STARTUPINFOEXW::default();
    si.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    si.lpAttributeList = attrs.ptr();
    let mut pi = PROCESS_INFORMATION::default();
    // SAFETY: every pointer is valid for the call. bInheritHandles is TRUE, but HANDLE_LIST limits
    // inheritance to the input handle.
    let ok = unsafe {
        CreateProcessW(
            app.as_ptr(),
            cmdline.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW,
            std::ptr::null(),
            std::ptr::null(),
            &si.StartupInfo,
            &mut pi,
        )
    };
    if ok == 0 {
        return Err(Error::last_os("CreateProcessW (AppContainer)"));
    }
    let process = Handle(pi.hProcess);
    let thread = Handle(pi.hThread);

    // SAFETY: both handles are valid; the child is still suspended.
    if unsafe { AssignProcessToJobObject(job.0, process.0) } == 0 {
        let err = Error::last_os("AssignProcessToJobObject");
        // SAFETY: valid process handle.
        unsafe { TerminateProcess(process.0, 1) };
        return Err(err);
    }
    // SAFETY: valid thread handle.
    if unsafe { ResumeThread(thread.0) } == u32::MAX {
        let err = Error::last_os("ResumeThread");
        // SAFETY: valid process handle.
        unsafe { TerminateProcess(process.0, 1) };
        return Err(err);
    }
    // SAFETY: valid process handle.
    match unsafe { WaitForSingleObject(process.0, WAIT_MS) } {
        WAIT_OBJECT_0 => {}
        WAIT_TIMEOUT => {
            // SAFETY: valid process handle.
            unsafe { TerminateProcess(process.0, 1) };
            return Err(Error::other("WaitForSingleObject", "probe ran past the time limit"));
        }
        _ => return Err(Error::last_os("WaitForSingleObject")),
    }
    let mut code = 0u32;
    // SAFETY: valid process handle and out pointer.
    if unsafe { GetExitCodeProcess(process.0, &mut code) } == 0 {
        return Err(Error::last_os("GetExitCodeProcess"));
    }
    Ok(Outcome { code: Some(code as i32), stderr: String::new() })
}
