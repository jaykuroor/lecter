//! Folders an earlier bundle identifier may have left behind, and moving them to the stable
//! folders (`01-architecture.md#app-identity-and-migration`).
//!
//! Lecter itself never writes under the identifier (Tauri's identifier-based path helpers are
//! banned), so what is found there came from Tauri: the webview's storage, which is discarded,
//! and anything else, which is moved into the matching stable folder.

use std::io;
use std::path::{Path, PathBuf};

use super::migrate::{LeftReason, Leftover, Report};
use crate::paths::{AppDirs, BaseDirs, Os};

/// What the webview keeps in Tauri's local data folder on Linux (WebKitGTK; wry adds `cookies`).
const WEBKITGTK: &[&str] = &[
    "CacheStorage",
    "WebKitCache",
    "applications",
    "cookies",
    "databases",
    "deviceidhashsalts",
    "hsts-storage.sqlite",
    "indexeddb",
    "itp",
    "localstorage",
    "mediakeys",
    "serviceworkers",
    "storage",
];

/// What WebView2 keeps in Tauri's local data folder on Windows.
const WEBVIEW2: &[&str] = &["EBWebView"];

/// What WKWebView keeps in the app's cache folder on macOS.
const WKWEBVIEW_CACHE: &[&str] = &["WebKit"];

/// One identifier-named folder and what becomes of its entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct LegacyRoot {
    /// The folder, e.g. `~/.local/share/<old identifier>`.
    pub path: PathBuf,
    /// Where its entries go; `None` discards the whole folder (webview-only folders).
    pub target: Option<PathBuf>,
    /// Entry names in it that are webview storage and are discarded.
    pub webview: &'static [&'static str],
}

/// The folders Tauri names after `id` on `os` (its `app_*_dir` helpers and the webviews' own
/// stores), each with the stable folder its entries move to. A folder two helpers share appears
/// once, as data.
pub(super) fn roots(id: &str, os: Os, base: &BaseDirs, dirs: &AppDirs) -> Vec<LegacyRoot> {
    let local_webview = match os {
        Os::Linux => WEBKITGTK,
        Os::Windows => WEBVIEW2,
        Os::MacOs => &[],
    };
    let cache_webview = if os == Os::MacOs { WKWEBVIEW_CACHE } else { &[] };
    let mut out: Vec<LegacyRoot> = Vec::new();
    let mut add = |path: PathBuf, target: Option<&Path>, webview: &'static [&'static str]| {
        if let Some(seen) = out.iter_mut().find(|r| r.path == path) {
            // Linux's data and local data folder are one folder; the webview lives in it.
            if seen.webview.is_empty() {
                seen.webview = webview;
            }
            return;
        }
        out.push(LegacyRoot { path, target: target.map(Path::to_path_buf), webview });
    };
    add(base.data.join(id), Some(dirs.data()), &[]);
    add(base.data_local.join(id), Some(dirs.data()), local_webview);
    add(base.config.join(id), Some(dirs.config()), &[]);
    add(base.cache.join(id), Some(dirs.cache()), cache_webview);
    if os == Os::MacOs {
        let library = base.home.join("Library");
        add(library.join("WebKit").join(id), None, &[]);
        add(library.join("HTTPStorages").join(id), None, &[]);
    }
    out
}

/// Empties `root` into its target (or discards it), adding what happened to `report`. The root is
/// removed when nothing is left in it. A root that is a link is left alone: it points somewhere
/// Lecter never put it.
#[allow(clippy::disallowed_methods, reason = "migrate() runs once at startup on a blocking thread")]
pub(super) fn migrate_root(root: &LegacyRoot, report: &mut Report) {
    let meta = match std::fs::symlink_metadata(&root.path) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return,
        Err(e) => return left(report, &root.path, LeftReason::Io(e.kind())),
    };
    if !meta.is_dir() {
        return left(report, &root.path, LeftReason::NotAFolder);
    }
    let Some(target) = &root.target else {
        return match remove_entry(&root.path) {
            Ok(()) => report.discarded.push(root.path.clone()),
            Err(e) => left(report, &root.path, LeftReason::Io(e.kind())),
        };
    };
    let entries = match list(&root.path) {
        Ok(e) => e,
        Err(e) => return left(report, &root.path, LeftReason::Io(e.kind())),
    };
    for (name, src) in entries {
        if name.to_str().is_some_and(|n| root.webview.contains(&n)) {
            match remove_entry(&src) {
                Ok(()) => report.discarded.push(src),
                Err(e) => left(report, &src, LeftReason::Io(e.kind())),
            }
        } else {
            move_entry(&src, &target.join(&name), report);
        }
    }
    // Fails, and so keeps the folder, when anything was left in it.
    let _ = std::fs::remove_dir(&root.path);
}

/// Moves `src` to `dst`. When `dst` exists, two folders merge entry by entry and anything else
/// stays where it is: the stable copy is the one in use.
#[allow(clippy::disallowed_methods, reason = "migrate() runs once at startup on a blocking thread")]
fn move_entry(src: &Path, dst: &Path, report: &mut Report) {
    match std::fs::symlink_metadata(dst) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return left(report, src, LeftReason::Io(e.kind())),
        Ok(dst_meta) => {
            let src_is_dir = std::fs::symlink_metadata(src).is_ok_and(|m| m.is_dir());
            if !(dst_meta.is_dir() && src_is_dir) {
                return left(report, src, LeftReason::Conflict(dst.to_path_buf()));
            }
            match list(src) {
                Ok(entries) => {
                    for (name, child) in entries {
                        move_entry(&child, &dst.join(name), report);
                    }
                }
                Err(e) => return left(report, src, LeftReason::Io(e.kind())),
            }
            let _ = std::fs::remove_dir(src);
            return;
        }
    }
    if let Some(parent) = dst.parent()
        && let Err(e) = std::fs::create_dir_all(parent)
    {
        return left(report, src, LeftReason::Io(e.kind()));
    }
    match relocate(src, dst, |a, b| std::fs::rename(a, b)) {
        Ok(()) => report.moved.push(dst.to_path_buf()),
        Err(e) => left(report, src, LeftReason::Io(e.kind())),
    }
}

/// Renames `src` to `dst` with `rename`; across file systems (a cache on tmpfs, …), where a rename
/// can't work, copies and then removes the original.
fn relocate(src: &Path, dst: &Path, rename: impl FnOnce(&Path, &Path) -> io::Result<()>) -> io::Result<()> {
    match rename(src, dst) {
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => copy_tree(src, dst).and_then(|()| remove_entry(src)),
        other => other,
    }
}

/// Copies a file, a folder (recursively) or, on Unix, a link (as a link) from `src` to a new `dst`.
#[allow(clippy::disallowed_methods, reason = "migrate() runs once at startup on a blocking thread")]
fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    let meta = std::fs::symlink_metadata(src)?;
    if meta.is_dir() {
        std::fs::create_dir(dst)?;
        for (name, child) in list(src)? {
            copy_tree(&child, &dst.join(name))?;
        }
        Ok(())
    } else if meta.file_type().is_symlink() {
        #[cfg(unix)]
        return std::os::unix::fs::symlink(std::fs::read_link(src)?, dst);
        #[cfg(not(unix))]
        return Err(io::Error::from(io::ErrorKind::Unsupported));
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// Removes a file, a link (never what it points to) or a whole folder.
#[allow(clippy::disallowed_methods, reason = "migrate() runs once at startup on a blocking thread")]
fn remove_entry(path: &Path) -> io::Result<()> {
    if std::fs::symlink_metadata(path)?.is_dir() { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) }
}

/// The entries of `dir`, sorted by name so a run is reproducible.
#[allow(clippy::disallowed_methods, reason = "migrate() runs once at startup on a blocking thread")]
fn list(dir: &Path) -> io::Result<Vec<(std::ffi::OsString, PathBuf)>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        out.push((entry.file_name(), entry.path()));
    }
    out.sort();
    Ok(out)
}

fn left(report: &mut Report, path: &Path, reason: LeftReason) {
    report.left.push(Leftover::Path { path: path.to_path_buf(), reason });
}

/// The copy fallback that a move across file systems takes (the other tests stay on one), and
/// the file-system errors the end-to-end tests can't provoke.
#[cfg(test)]
#[allow(clippy::disallowed_methods, reason = "tests set up files on plain test threads")]
mod tests {
    use std::io;
    use std::path::Path;

    use super::{LegacyRoot, copy_tree, migrate_root, relocate, remove_entry};
    use crate::identity::{LeftReason, Leftover, Report};
    use crate::testenv::TestEnv;

    fn failing(kind: io::ErrorKind) -> impl FnOnce(&Path, &Path) -> io::Result<()> {
        move |_, _| Err(io::Error::from(kind))
    }

    #[test]
    fn a_move_across_file_systems_copies_then_removes_the_original() {
        let env = TestEnv::new().unwrap();
        let (src, dst) = (env.home().join("src"), env.home().join("dst"));
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("sub/f"), "f").unwrap();
        relocate(&src, &dst, failing(io::ErrorKind::CrossesDevices)).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("sub/f")).unwrap(), "f");
        assert!(!src.exists(), "the original was kept after the copy");
    }

    #[test]
    fn other_rename_failures_copy_nothing_and_keep_the_original() {
        let env = TestEnv::new().unwrap();
        let (src, dst) = (env.home().join("src"), env.home().join("dst"));
        std::fs::write(&src, "s").unwrap();
        for kind in [io::ErrorKind::PermissionDenied, io::ErrorKind::NotFound, io::ErrorKind::Other] {
            let got = relocate(&src, &dst, failing(kind));
            assert_eq!(got.map_err(|e| e.kind()), Err(kind));
            assert!(!dst.exists(), "{kind:?}: copied anyway");
            assert_eq!(std::fs::read_to_string(&src).unwrap(), "s");
        }
        relocate(&src, &dst, |_, _| Ok(())).unwrap();
        assert!(!dst.exists(), "a working rename needs no copy");
    }

    #[cfg(unix)]
    #[test]
    fn a_legacy_folder_that_cannot_be_inspected_is_reported() {
        let env = TestEnv::new().unwrap();
        let file = env.home().join("a-file");
        std::fs::write(&file, "x").unwrap();
        let root = LegacyRoot { path: file.join("old"), target: Some(env.home().join("t")), webview: &[] };
        let mut report = Report::default();
        migrate_root(&root, &mut report);
        let want = Leftover::Path { path: root.path.clone(), reason: LeftReason::Io(io::ErrorKind::NotADirectory) };
        assert_eq!(report.left, [want]);
    }

    #[cfg(unix)]
    #[test]
    fn a_target_that_cannot_be_inspected_leaves_the_entry() {
        let env = TestEnv::new().unwrap();
        let legacy = env.home().join("old");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("x"), "x").unwrap();
        let target = env.home().join("target-is-a-file");
        std::fs::write(&target, "t").unwrap();
        let root = LegacyRoot { path: legacy.clone(), target: Some(target), webview: &[] };
        let mut report = Report::default();
        migrate_root(&root, &mut report);
        let want = Leftover::Path { path: legacy.join("x"), reason: LeftReason::Io(io::ErrorKind::NotADirectory) };
        assert_eq!(report.left, [want]);
        assert!(report.moved.is_empty());
        assert_eq!(std::fs::read_to_string(legacy.join("x")).unwrap(), "x");
    }

    #[test]
    fn copy_tree_copies_files_folders_and_links_then_remove_entry_clears_the_source() {
        let env = TestEnv::new().unwrap();
        let src = env.home().join("src");
        std::fs::create_dir_all(src.join("a/b")).unwrap();
        std::fs::write(src.join("top.txt"), "top").unwrap();
        std::fs::write(src.join("a/b/deep.bin"), [0u8, 1, 2]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("a/b/deep.bin", src.join("link")).unwrap();
        let dst = env.home().join("dst");

        copy_tree(&src, &dst).unwrap();

        assert_eq!(std::fs::read_to_string(dst.join("top.txt")).unwrap(), "top");
        assert_eq!(std::fs::read(dst.join("a/b/deep.bin")).unwrap(), [0u8, 1, 2]);
        #[cfg(unix)]
        {
            let link = dst.join("link");
            assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(), "a link copied as a file");
            assert_eq!(std::fs::read_link(&link).unwrap(), std::path::Path::new("a/b/deep.bin"));
        }
        remove_entry(&src).unwrap();
        assert!(!src.exists());
        assert!(dst.join("top.txt").exists(), "removing the source touched the copy");
    }

    #[test]
    fn copy_tree_never_overwrites_and_a_single_file_copies_alone() {
        let env = TestEnv::new().unwrap();
        let (file, dst) = (env.home().join("f.txt"), env.home().join("g.txt"));
        std::fs::write(&file, "f").unwrap();
        copy_tree(&file, &dst).unwrap();
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "f");
        let dir = env.home().join("d");
        std::fs::create_dir(&dir).unwrap();
        std::fs::create_dir(env.home().join("taken")).unwrap();
        assert!(copy_tree(&dir, &env.home().join("taken")).is_err(), "copied over an existing folder");
    }

    #[cfg(unix)]
    #[test]
    fn remove_entry_removes_a_link_not_its_target() {
        let env = TestEnv::new().unwrap();
        let target = env.home().join("target");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("keep"), "k").unwrap();
        let link = env.home().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        remove_entry(&link).unwrap();
        assert!(std::fs::symlink_metadata(&link).is_err());
        assert_eq!(std::fs::read_to_string(target.join("keep")).unwrap(), "k");
    }
}
