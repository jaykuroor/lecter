//! Criterion 1 (SEC-51): the script downloads all five pinned targets, checks each SHA-256, and
//! refuses a file that doesn't match before anything uses it.
#![allow(clippy::disallowed_methods, reason = "synchronous spike test; no async runtime")]

use std::fs;
use std::path::{Path, PathBuf};

use lecter_spike_pdfium::{default_cache_dir, fetch_host_library, run_fetch_script, spike_dir};

const TARGETS: [&str; 5] = ["linux-x64", "linux-arm64", "macos-universal", "windows-x64", "windows-arm64"];

/// The pin recorded for `target` in the pins.json text (no JSON crate: one `"sha256"` per target block).
fn pin_for(pins: &str, target: &str) -> Result<String, String> {
    let block = pins.find(&format!("\"{target}\": {{")).ok_or_else(|| format!("{target} missing from pins.json"))?;
    let key = "\"sha256\": \"";
    let at = pins[block..].find(key).ok_or_else(|| format!("no sha256 for {target}"))? + block + key.len();
    pins.get(at..at + 64).map(str::to_owned).ok_or_else(|| format!("short sha256 for {target}"))
}

#[test]
fn all_five_targets_download_and_match_their_pins() {
    let pins = fs::read_to_string(spike_dir().join("pins.json")).unwrap();
    let dest = default_cache_dir().to_string_lossy().into_owned();
    let out = run_fetch_script(&["--all", "--report", "--dest", &dest]).unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "fetch --all failed ({}):\n{stdout}\n{stderr}", out.status);
    println!("{stdout}");
    for t in TARGETS {
        let line = stdout
            .lines()
            .find(|l| l.starts_with(&format!("{t}\t")))
            .unwrap_or_else(|| panic!("no report line for {t} in:\n{stdout}"));
        let computed = line.rsplit("sha256 ").next().unwrap_or_default().trim();
        assert_eq!(computed, pin_for(&pins, t).unwrap(), "{t}: SHA-256 computed from the archive bytes vs pins.json");
    }

    // Every target refuses its own archive once a byte changes, and places no library for it.
    let (root, scratch_pins) = scratch("all-corrupt").unwrap();
    let tag_dir = only_subdir(&root.join("cache")).unwrap();
    for entry in fs::read_dir(&tag_dir).unwrap().flatten() {
        corrupt(&entry.path()).unwrap();
    }
    for t in TARGETS {
        let (code, output) = run_offline(&root, &scratch_pins, Some(t)).unwrap();
        assert_eq!(code, 3, "{t}: expected exit 3 (mismatch) for a corrupted archive, got {code}:\n{output}");
        assert!(output.contains(&format!("SHA-256 mismatch for {t}")), "{t}: {output}");
        assert!(libraries_under(&tag_dir.join(t)).is_empty(), "{t}: library placed from a corrupted archive");
    }
    let _ = fs::remove_dir_all(root);
}

fn only_subdir(dir: &Path) -> Result<PathBuf, String> {
    let mut entries = fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?.flatten();
    entries.next().map(|e| e.path()).ok_or_else(|| format!("{} is empty", dir.display()))
}

fn corrupt(path: &Path) -> Result<(), String> {
    let mut bytes = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mid = bytes.len() / 2;
    bytes[mid] ^= 0xff;
    fs::write(path, bytes).map_err(|e| format!("write {}: {e}", path.display()))
}

/// A scratch copy of the cache holding every verified archive present (at least the host's), and a pins file to tamper with.
fn scratch(name: &str) -> Result<(PathBuf, PathBuf), String> {
    let lib = fetch_host_library(&default_cache_dir()).map_err(|e| format!("host library: {e}"))?;
    let tag_dir = lib
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| format!("cache layout is not <dest>/<tag>/<target>/<lib>: {}", lib.display()))?;
    let tag_name = tag_dir.file_name().ok_or_else(|| format!("no tag dir name: {}", tag_dir.display()))?;
    let root = std::env::temp_dir().join(format!("lecter-spike-pdfium-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let copy = root.join("cache").join(tag_name);
    fs::create_dir_all(&copy).map_err(|e| format!("create {}: {e}", copy.display()))?;
    let entries = fs::read_dir(tag_dir).map_err(|e| format!("read {}: {e}", tag_dir.display()))?;
    for entry in entries {
        let p = entry.map_err(|e| format!("dir entry: {e}"))?.path();
        if let (Some("tgz"), Some(file)) = (p.extension().and_then(|e| e.to_str()), p.file_name()) {
            fs::copy(&p, copy.join(file)).map_err(|e| format!("copy {}: {e}", p.display()))?;
        }
    }
    let pins = root.join("pins.json");
    fs::copy(spike_dir().join("pins.json"), &pins).map_err(|e| format!("copy pins.json: {e}"))?;
    Ok((root, pins))
}

fn libraries_under(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = entry.path();
        if p.is_dir() {
            found.extend(libraries_under(&p));
        } else if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.contains("pdfium.") && !n.ends_with(".tgz"))
        {
            found.push(p);
        }
    }
    found
}

fn run_offline(root: &Path, pins: &Path, target: Option<&str>) -> Result<(i32, String), String> {
    let dest = root.join("cache").to_string_lossy().into_owned();
    let pins = pins.to_string_lossy().into_owned();
    let mut args = vec!["--offline", "--dest", &dest, "--pins", &pins];
    if let Some(t) = target {
        args.extend(["--target", t]);
    }
    let out = run_fetch_script(&args).map_err(|e| e.to_string())?;
    Ok((
        out.status.code().unwrap_or(-1),
        format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)),
    ))
}

fn archives_under(dir: &Path) -> usize {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "tgz"))
        .count()
}

#[test]
fn a_wrong_pin_is_refused_before_use() {
    let (root, pins) = scratch("wrong-pin").unwrap();
    let text = fs::read_to_string(&pins).expect("read pins");
    let tampered: String = text
        .lines()
        .map(|l| match l.find("\"sha256\": \"") {
            Some(i) => format!("{}\"sha256\": \"{}\",", &l[..i], "0".repeat(64)),
            None => l.to_owned(),
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&pins, tampered).expect("write pins");

    let (code, output) = run_offline(&root, &pins, None).unwrap();
    assert_eq!(code, 3, "expected exit 3 (mismatch), got {code}:\n{output}");
    assert!(output.contains("SHA-256 mismatch"), "{output}");
    let cache = root.join("cache");
    assert!(
        libraries_under(&cache).is_empty(),
        "a library was placed from an unverified archive: {:?}",
        libraries_under(&cache)
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_corrupted_archive_is_refused_and_deleted() {
    let (root, pins) = scratch("corrupt").unwrap();
    let tag_dir = only_subdir(&root.join("cache")).unwrap();
    let before = archives_under(&tag_dir);
    for entry in fs::read_dir(&tag_dir).unwrap().flatten() {
        corrupt(&entry.path()).unwrap();
    }

    let (code, output) = run_offline(&root, &pins, None).unwrap();
    assert_eq!(code, 3, "expected exit 3 (mismatch), got {code}:\n{output}");
    assert!(output.contains("SHA-256 mismatch"), "{output}");
    assert!(libraries_under(&tag_dir).is_empty(), "library placed from a corrupted archive");
    assert!(archives_under(&tag_dir) < before, "mismatched archive was kept");
    let _ = fs::remove_dir_all(root);
}
