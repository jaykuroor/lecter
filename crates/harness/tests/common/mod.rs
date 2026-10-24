//! Helpers shared by the harness tests that run `scripts/init.sh` against a stubbed PATH.

/// A PATH holding only the basic tools init.sh needs to run, so every developer tool is "missing".
/// Each `extra` entry adds an executable `/bin/sh` stub with that name and body.
#[cfg(unix)]
pub fn bare_path(extra: &[(&str, &str)]) -> Result<tempdir::Dir, String> {
    let dir = tempdir::Dir::new()?;
    let real = std::env::var("PATH").unwrap_or_default();
    for tool in ["bash", "dirname", "uname", "mkdir", "sed", "head", "ln", "cat", "grep", "tr", "readlink"] {
        let found = std::env::split_paths(&real).map(|p| p.join(tool)).find(|p| p.is_file());
        let src = found.ok_or(format!("{tool} not on PATH"))?;
        std::os::unix::fs::symlink(&src, dir.path().join(tool)).map_err(|e| e.to_string())?;
    }
    for (name, body) in extra {
        let p = dir.path().join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// A temporary directory removed on drop (std only; no tempfile dependency for a few tests).
#[cfg(unix)]
pub mod tempdir {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    pub struct Dir(PathBuf);

    impl Dir {
        pub fn new() -> Result<Self, String> {
            let n = N.fetch_add(1, Ordering::Relaxed);
            let exe = std::env::current_exe().ok();
            let bin = exe.as_deref().and_then(|p| p.file_stem()).and_then(|s| s.to_str()).unwrap_or("test");
            let p = std::env::temp_dir().join(format!("lecter-{bin}-{}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).map_err(|e| format!("{}: {e}", p.display()))?;
            Ok(Self(p))
        }
        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
