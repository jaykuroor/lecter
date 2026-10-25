//! Restricted tokens, Chromium style (lockdown level), layered under the LPAC AppContainer.
//!
//! LPAC alone still reads files that grant ALL RESTRICTED APPLICATION PACKAGES, such as
//! `%SystemRoot%\win.ini` (CI run 40120703752). A restricted token adds a second access check
//! against its restricting SIDs. The lockdown token restricts to the NULL SID, which no file grants,
//! so every new open fails.
//!
//! - **lockdown** (the child's primary token): all privileges but SeChangeNotify removed, the user
//!   SID and every group deny-only (integrity label excepted), restricting SIDs = {NULL}.
//! - **initial** (impersonated by the child's main thread only while the loader runs): privileges
//!   removed, restricting SIDs = the user, every enabled group and RESTRICTED. Its access is
//!   roughly the user's own, so DLLs load. The child drops it with `RevertToSelf` in `enter()`.
//!
//! Both are restricted, so the kernel lets the lockdown process impersonate the initial token.

use windows_sys::Win32::Foundation::{ERROR_NO_TOKEN, GetLastError, HANDLE};
use windows_sys::Win32::Security::{
    CreateRestrictedToken, DISABLE_MAX_PRIVILEGE, GetTokenInformation, PSID, RevertToSelf, SID_AND_ATTRIBUTES,
    TOKEN_GROUPS, TOKEN_QUERY, TOKEN_USER, TokenGroups, TokenUser,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetCurrentThread, OpenProcessToken, OpenThreadToken};

use super::Handle;
use crate::Error;

/// `SE_GROUP_ENABLED` (winnt.h).
const SE_GROUP_ENABLED: u32 = 0x4;
/// `SE_GROUP_INTEGRITY` (winnt.h): the mandatory label, which can't be made deny-only.
const SE_GROUP_INTEGRITY: u32 = 0x20;
/// `TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT`.
const BASE_ACCESS: u32 = 0x2 | 0x8 | 0x1 | 0x80;

/// S-1-0-0 (NULL SID) as SID bytes: revision 1, one sub-authority, authority 0, sub-authority 0.
static NULL_SID: [u32; 3] = [0x0000_0101, 0, 0];
/// S-1-5-12 (RESTRICTED): revision 1, one sub-authority, authority 5 (big-endian), sub-authority 12.
static RESTRICTED_SID: [u32; 3] = [0x0000_0101, 0x0500_0000, 12];

fn sid_ptr(sid: &'static [u32; 3]) -> PSID {
    sid.as_ptr().cast_mut().cast()
}

/// Reads one token information class into an 8-byte-aligned buffer.
fn info(token: HANDLE, class: i32) -> Result<Vec<u64>, Error> {
    let mut len = 0u32;
    // SAFETY: size query with a null buffer.
    unsafe { GetTokenInformation(token, class, std::ptr::null_mut(), 0, &mut len) };
    let mut buf = vec![0u64; (len as usize).div_ceil(8)];
    // SAFETY: `buf` holds at least `len` bytes.
    if unsafe { GetTokenInformation(token, class, buf.as_mut_ptr().cast(), len, &mut len) } == 0 {
        return Err(Error::last_os("GetTokenInformation"));
    }
    Ok(buf)
}

fn restrict(
    base: HANDLE,
    deny_only: &[SID_AND_ATTRIBUTES],
    restricting: &[SID_AND_ATTRIBUTES],
) -> Result<Handle, Error> {
    let mut out: HANDLE = std::ptr::null_mut();
    // SAFETY: the SID arrays point into buffers that outlive the call; `out` receives a new token.
    let ok = unsafe {
        CreateRestrictedToken(
            base,
            DISABLE_MAX_PRIVILEGE,
            deny_only.len() as u32,
            deny_only.as_ptr(),
            0,
            std::ptr::null(),
            restricting.len() as u32,
            restricting.as_ptr(),
            &mut out,
        )
    };
    if ok == 0 {
        return Err(Error::last_os("CreateRestrictedToken"));
    }
    Ok(Handle(out))
}

/// Returns (lockdown, initial) primary tokens derived from this process's token.
pub fn lockdown_and_initial() -> Result<(Handle, Handle), Error> {
    let mut raw: HANDLE = std::ptr::null_mut();
    // SAFETY: pseudo-handle for this process; `raw` receives a token handle.
    if unsafe { OpenProcessToken(GetCurrentProcess(), BASE_ACCESS, &mut raw) } == 0 {
        return Err(Error::last_os("OpenProcessToken"));
    }
    let base = Handle(raw);
    let user_buf = info(base.0, TokenUser)?;
    let groups_buf = info(base.0, TokenGroups)?;
    // SAFETY: the buffers hold a TOKEN_USER and a TOKEN_GROUPS written by GetTokenInformation.
    let user = unsafe { (*user_buf.as_ptr().cast::<TOKEN_USER>()).User.Sid };
    // SAFETY: as above; `Groups` is a variable-length array of `GroupCount` entries.
    let groups = unsafe {
        let tg = groups_buf.as_ptr().cast::<TOKEN_GROUPS>();
        std::slice::from_raw_parts((&raw const (*tg).Groups).cast::<SID_AND_ATTRIBUTES>(), (*tg).GroupCount as usize)
    };
    let entry = |sid: PSID| SID_AND_ATTRIBUTES { Sid: sid, Attributes: 0 };

    let mut deny_only: Vec<SID_AND_ATTRIBUTES> = vec![entry(user)];
    deny_only.extend(groups.iter().filter(|g| g.Attributes & SE_GROUP_INTEGRITY == 0).map(|g| entry(g.Sid)));
    let lockdown = restrict(base.0, &deny_only, &[entry(sid_ptr(&NULL_SID))])?;

    let mut restricting: Vec<SID_AND_ATTRIBUTES> = vec![entry(user), entry(sid_ptr(&RESTRICTED_SID))];
    restricting.extend(
        groups
            .iter()
            .filter(|g| g.Attributes & SE_GROUP_ENABLED != 0 && g.Attributes & SE_GROUP_INTEGRITY == 0)
            .map(|g| entry(g.Sid)),
    );
    let initial = restrict(base.0, &[], &restricting)?;
    Ok((lockdown, initial))
}

/// Child side: drop the startup impersonation token so the lockdown token governs every new open.
/// Fails closed if the thread still has a token afterwards.
pub fn drop_startup_token() -> Result<(), Error> {
    // SAFETY: no arguments; ends impersonation on this thread.
    if unsafe { RevertToSelf() } == 0 {
        return Err(Error::last_os("RevertToSelf"));
    }
    let mut token: HANDLE = std::ptr::null_mut();
    // SAFETY: pseudo-handle for this thread; a token, if any, lands in `token`.
    let opened = unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut token) };
    if opened != 0 {
        drop(Handle(token));
        return Err(Error::other("RevertToSelf", "the thread still impersonates a token"));
    }
    // SAFETY: reads this thread's last error.
    let err = unsafe { GetLastError() };
    if err != ERROR_NO_TOKEN {
        return Err(Error::new("OpenThreadToken", std::io::Error::from_raw_os_error(err as i32)));
    }
    Ok(())
}
