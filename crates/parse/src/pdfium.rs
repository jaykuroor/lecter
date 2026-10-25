//! Finding and loading the pinned PDFium library (D-084, D-087).
//!
//! The library is loaded from an absolute path inside the folder the core names (the app's
//! resource folder, or the verified download under `target/pdfium/` in development), never from
//! the system search path: a PDFium on `PATH` or `LD_LIBRARY_PATH` is never picked up.

use std::path::{Path, PathBuf};

use pdfium_render::prelude::Pdfium;

use crate::error::{Error, Result};

/// The pinned release's folder under `target/pdfium/` (`spikes/pdfium/pins.json` tag `chromium/7881`).
pub const TAG_DIR: &str = "chromium-7881";

/// The library's file name on this OS.
pub const LIBRARY_FILE: &str = if cfg!(target_os = "windows") {
    "pdfium.dll"
} else if cfg!(target_os = "macos") {
    "libpdfium.dylib"
} else {
    "libpdfium.so"
};

/// This machine's target name in `pins.json` (`linux-x64`, `macos-universal`, …).
pub const HOST_TARGET: &str = if cfg!(target_os = "windows") {
    if cfg!(target_arch = "aarch64") { "windows-arm64" } else { "windows-x64" }
} else if cfg!(target_os = "macos") {
    "macos-universal"
} else if cfg!(target_arch = "aarch64") {
    "linux-arm64"
} else {
    "linux-x64"
};

/// The library inside `dir`. `dir` must be absolute and the library must be there: there is no
/// fallback to a library found anywhere else.
pub fn library_path(dir: &Path) -> Result<PathBuf> {
    if !dir.is_absolute() {
        return Err(Error::Engine(format!("the PDFium folder must be an absolute path, got {}", dir.display())));
    }
    let lib = dir.join(LIBRARY_FILE);
    if !lib.is_file() {
        return Err(Error::Engine(format!("PDFium is missing: no {LIBRARY_FILE} in {}", dir.display())));
    }
    Ok(lib)
}

/// Loads PDFium from `dir` (see [`library_path`]). One binding per process.
pub fn bind(dir: &Path) -> Result<Pdfium> {
    let lib = library_path(dir)?;
    let bindings = Pdfium::bind_to_library(&lib)
        .map_err(|e| Error::Engine(format!("PDFium could not be loaded from {}: {e}", lib.display())))?;
    Ok(Pdfium::new(bindings))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_folder_is_refused() {
        let e = library_path(Path::new("target/pdfium")).unwrap_err();
        assert!(matches!(&e, Error::Engine(m) if m.contains("absolute")), "{e:?}");
    }

    #[test]
    fn a_folder_without_the_library_is_refused_with_no_fallback() {
        let dir = std::env::temp_dir().join("lecter-parse-no-pdfium");
        let e = library_path(&dir).unwrap_err();
        assert!(matches!(&e, Error::Engine(m) if m.contains(LIBRARY_FILE)), "{e:?}");
        assert!(bind(&dir).is_err());
    }

    #[test]
    fn the_resolved_library_is_absolute_and_inside_the_folder() {
        let dir = std::env::temp_dir().join(format!("lecter-parse-pdfium-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(LIBRARY_FILE), b"not really a library").unwrap();
        let lib = library_path(&dir).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(lib.is_absolute());
        assert_eq!(lib, dir.join(LIBRARY_FILE));
    }

    #[test]
    fn names_match_the_pins_file_and_the_os() {
        let pins = include_str!("../../../spikes/pdfium/pins.json");
        assert!(pins.contains(r#""tag": "chromium/7881""#), "TAG_DIR {TAG_DIR} no longer matches pins.json");
        assert_eq!(TAG_DIR, "chromium-7881");
        assert!(pins.contains(&format!("\"{HOST_TARGET}\": {{")), "{HOST_TARGET} is not a pinned target");
        let lib_line = pins
            .split(&format!("\"{HOST_TARGET}\": {{"))
            .nth(1)
            .and_then(|rest| rest.lines().find(|l| l.contains("\"library\"")))
            .unwrap_or_default();
        assert!(lib_line.ends_with(&format!("/{LIBRARY_FILE}\"")), "{lib_line}");
    }
}
