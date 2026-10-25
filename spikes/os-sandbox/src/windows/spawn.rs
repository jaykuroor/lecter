//! `CreateProcessAsUserW` into the LPAC AppContainer, suspended, with an exact inherited-handle list.

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Security::{PSID, SECURITY_CAPABILITIES};
use windows_sys::Win32::System::Threading::{
    CREATE_SUSPENDED, CreateProcessAsUserW, DETACHED_PROCESS, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, InitializeProcThreadAttributeList,
    PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    UpdateProcThreadAttribute,
};

use crate::Error;

/// `PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT` (winbase.h).
const PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT: u32 = 1;

/// A PROC_THREAD_ATTRIBUTE_LIST in a usize-aligned buffer.
struct AttrList(Vec<usize>);

impl AttrList {
    fn new(count: u32) -> Result<Self, Error> {
        let mut size = 0usize;
        // SAFETY: size query with a null list; it fails with ERROR_INSUFFICIENT_BUFFER and sets `size`.
        unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), count, 0, &mut size) };
        let mut buf = vec![0usize; size.div_ceil(size_of::<usize>())];
        // SAFETY: `buf` holds at least `size` bytes.
        if unsafe { InitializeProcThreadAttributeList(buf.as_mut_ptr().cast(), count, 0, &mut size) } == 0 {
            return Err(Error::last_os("InitializeProcThreadAttributeList"));
        }
        Ok(Self(buf))
    }

    fn ptr(&mut self) -> *mut core::ffi::c_void {
        self.0.as_mut_ptr().cast()
    }

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

/// Starts `app` suspended with `token`, inside the LPAC container `sid`. Only `inherited` handles
/// reach the child (none if empty); `stderr`, if not null, must be one of them.
pub fn suspended(
    token: HANDLE,
    sid: PSID,
    app: &[u16],
    cmdline: &mut [u16],
    inherited: &[HANDLE],
    stderr: HANDLE,
) -> Result<PROCESS_INFORMATION, Error> {
    let mut attrs = AttrList::new(if inherited.is_empty() { 2 } else { 3 })?;
    let caps = SECURITY_CAPABILITIES {
        AppContainerSid: sid,
        Capabilities: std::ptr::null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };
    // Less Privileged AppContainer: ALL APPLICATION PACKAGES grants no longer apply.
    let lpac: u32 = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
    // SAFETY (all): each value outlives CreateProcessAsUserW below; the list has room for them.
    unsafe {
        attrs.set(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, (&raw const caps).cast(), size_of_val(&caps))?;
        attrs.set(
            PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
            (&raw const lpac).cast(),
            size_of_val(&lpac),
        )?;
        if !inherited.is_empty() {
            attrs.set(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited.as_ptr().cast(), size_of_val(inherited))?;
        }
    }
    let mut si = STARTUPINFOEXW::default();
    si.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    si.lpAttributeList = attrs.ptr();
    if !stderr.is_null() {
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.StartupInfo.hStdError = stderr;
    }
    let mut pi = PROCESS_INFORMATION::default();
    // SAFETY: every pointer is valid for the call. bInheritHandles is TRUE only with a HANDLE_LIST,
    // which limits inheritance to exactly those handles. DETACHED_PROCESS: no console.
    let ok = unsafe {
        CreateProcessAsUserW(
            token,
            app.as_ptr(),
            cmdline.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            i32::from(!inherited.is_empty()),
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | DETACHED_PROCESS,
            std::ptr::null(),
            std::ptr::null(),
            &si.StartupInfo,
            &mut pi,
        )
    };
    if ok == 0 {
        return Err(Error::last_os("CreateProcessAsUserW (LPAC + restricted token)"));
    }
    Ok(pi)
}
