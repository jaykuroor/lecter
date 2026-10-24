//! F-014 code-health gates (`01-architecture.md#repository-layout`, `14-quality.md#protected-checks`,
//! `01-architecture.md#app-identity-and-migration`): the clippy configuration, the architecture lint
//! and the file-length lint, each run against a fixture that must fail and the real tree that must
//! pass. jscpd and knip are tested from the UI side (`ui/test/lint-gates.test.ts`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Crates that never run on an async runtime thread, so they may block on std::fs and std::net.
const SYNC_CRATES: [&str; 3] = ["parse", "models", "harness"];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(p: &Path) -> Result<String, String> {
    std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))
}

fn write(p: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(p, text).map_err(|e| format!("{}: {e}", p.display()))
}

/// Copies a fixture tree, renaming `Cargo.fixture.toml` to `Cargo.toml`. The fixture's manifests
/// carry the other name in the repo so the workspace tools (check_deps, cargo) never treat the
/// stand-in `tauri` crate as a real dependency.
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    for e in std::fs::read_dir(from).map_err(|e| format!("{}: {e}", from.display()))? {
        let p = e.map_err(|e| e.to_string())?.path();
        let name = p.file_name().and_then(|n| n.to_str()).ok_or("unnamed entry")?;
        let dest = to.join(if name == "Cargo.fixture.toml" { "Cargo.toml" } else { name });
        if p.is_dir() {
            copy_tree(&p, &dest)?;
        } else {
            write(&dest, &read(&p)?)?;
        }
    }
    Ok(())
}

/// A fresh folder under the system temp dir, removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Result<Self, String> {
        let p = std::env::temp_dir().join(format!("lecter-lint-gates-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        Ok(Self(p))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn run(cmd: &mut Command) -> Result<Output, String> {
    cmd.output().map_err(|e| format!("{cmd:?}: {e}"))
}

fn text(out: &Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))
}

/// `python3`, or `python` where only that exists (verify.sh picks the same way).
fn python() -> Result<&'static str, String> {
    ["python3", "python"]
        .into_iter()
        .find(|py| Command::new(py).arg("--version").output().is_ok_and(|o| o.status.success()))
        .ok_or_else(|| "no python3 or python on PATH".to_string())
}

/// A Python command whose stdout and stderr are UTF-8 on every OS. On Windows Python writes to a
/// pipe in the ANSI code page (cp1252), which can't encode the `→` the check scripts print, so the
/// script crashes with UnicodeEncodeError (CI-4ec6f29). `text` reads the output back as UTF-8.
fn py() -> Result<Command, String> {
    let mut cmd = Command::new(python()?);
    cmd.env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8");
    Ok(cmd)
}

/// The `path = "..."` entries of a clippy.toml's disallowed-methods, in order.
fn disallowed(conf: &str) -> Vec<String> {
    conf.lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .filter_map(|l| l.split_once("path = \"").and_then(|(_, rest)| rest.split_once('"')))
        .map(|(path, _)| path.to_string())
        .collect()
}

/// The `[workspace.lints.*]` tables of the real root Cargo.toml, verbatim.
fn workspace_lints() -> Result<String, String> {
    let ws = read(&repo_root().join("Cargo.toml"))?;
    let mut out = String::new();
    let mut inside = false;
    for line in ws.lines() {
        if line.starts_with('[') {
            inside = line.starts_with("[workspace.lints");
        }
        if inside {
            out.push_str(line);
            out.push('\n');
        }
    }
    if out.is_empty() {
        return Err("Cargo.toml has no [workspace.lints] tables".into());
    }
    Ok(out)
}

/// Runs clippy on `tests/fixtures/lint/clippy` with the real workspace lints and the clippy.toml in
/// `conf_dir`; returns clippy's short-format output.
fn clippy_fixture(conf_dir: &Path, tag: &str) -> Result<String, String> {
    let root = repo_root();
    let ws = Scratch::new(tag)?;
    copy_tree(&root.join("tests/fixtures/lint/clippy"), &ws.0)?;
    let manifest =
        format!("[workspace]\nresolver = \"3\"\nmembers = [\"banned\", \"tauri\"]\n\n{}", workspace_lints()?);
    write(&ws.0.join("Cargo.toml"), &manifest)?;
    write(&ws.0.join("rust-toolchain.toml"), &read(&root.join("rust-toolchain.toml"))?)?;
    let out = run(Command::new("cargo")
        .args(["clippy", "--all-targets", "--offline", "--quiet", "--message-format=short"])
        .current_dir(&ws.0)
        .env("CLIPPY_CONF_DIR", conf_dir)
        .env("CARGO_TARGET_DIR", root.join("target/lint-fixture").join(tag))
        .env_remove("RUSTFLAGS"))?;
    let all = text(&out);
    if !all.contains("banned") {
        return Err(format!("clippy did not lint the fixture:\n{all}"));
    }
    Ok(all)
}

fn reported(out: &str, path: &str) -> bool {
    out.contains(&format!("use of a disallowed method `{path}`"))
}

/// The fixture line holding `v.unwrap() + v.expect("EXPECT_OUTSIDE_TEST")`, as `lib.rs:<n>:`.
fn outside_test_line() -> Result<String, String> {
    let src = read(&repo_root().join("tests/fixtures/lint/clippy/banned/src/lib.rs"))?;
    let n = src.lines().position(|l| l.contains("\"EXPECT_OUTSIDE_TEST\"")).ok_or("marker missing")?;
    Ok(format!("lib.rs:{}:", n + 1))
}

#[test]
fn root_clippy_toml_denies_unwrap_and_expect_outside_tests_only() -> Result<(), String> {
    let conf = read(&repo_root().join("clippy.toml"))?;
    for key in ["allow-unwrap-in-tests = true", "allow-expect-in-tests = true"] {
        assert!(conf.lines().any(|l| l.trim() == key), "clippy.toml lacks `{key}`");
    }
    let out = clippy_fixture(&repo_root(), "unwrap")?;
    let line = outside_test_line()?;
    for lint in ["used `unwrap()` on an `Option` value", "used `expect()` on an `Option` value"] {
        let hits: Vec<&str> = out.lines().filter(|l| l.contains(lint)).collect();
        assert_eq!(hits.len(), 1, "want `{lint}` once, outside the test module:\n{out}");
        assert!(hits[0].contains(&line), "`{lint}` reported at the wrong place: {}", hits[0]);
        assert!(hits[0].contains("error"), "`{lint}` must be denied: {}", hits[0]);
    }
    Ok(())
}

#[test]
fn root_clippy_toml_bans_blocking_calls_and_identifier_paths_and_each_is_reported() -> Result<(), String> {
    let conf = read(&repo_root().join("clippy.toml"))?;
    let paths = disallowed(&conf);
    let required = [
        "std::thread::sleep",
        "std::fs::read",
        "std::fs::read_to_string",
        "std::fs::write",
        "std::fs::File::open",
        "std::fs::File::create",
        "std::fs::OpenOptions::open",
        "std::net::TcpStream::connect",
        "std::net::TcpListener::bind",
        "std::net::UdpSocket::bind",
        "std::net::ToSocketAddrs::to_socket_addrs",
        "tauri::path::PathResolver::app_config_dir",
        "tauri::path::PathResolver::app_data_dir",
        "tauri::path::PathResolver::app_cache_dir",
        "tauri::path::PathResolver::app_local_data_dir",
    ];
    for want in required {
        assert!(paths.iter().any(|p| p == want), "clippy.toml does not disallow {want}");
    }
    let out = clippy_fixture(&repo_root(), "async")?;
    let missed: Vec<&String> = paths.iter().filter(|p| !reported(&out, p)).collect();
    assert!(missed.is_empty(), "clippy did not report {missed:?} on the fixture:\n{out}");
    Ok(())
}

#[test]
fn sync_crates_keep_every_ban_except_blocking_fs_and_net() -> Result<(), String> {
    let root = repo_root();
    let async_paths = disallowed(&read(&root.join("clippy.toml"))?);
    let want: Vec<&String> =
        async_paths.iter().filter(|p| !p.starts_with("std::fs::") && !p.starts_with("std::net::")).collect();
    let first = read(&root.join("crates/parse/clippy.toml"))?;
    for c in SYNC_CRATES {
        let conf = read(&root.join(format!("crates/{c}/clippy.toml")))?;
        assert_eq!(conf, first, "crates/{c}/clippy.toml differs from crates/parse/clippy.toml");
        for key in ["allow-unwrap-in-tests = true", "allow-expect-in-tests = true"] {
            assert!(conf.lines().any(|l| l.trim() == key), "crates/{c}/clippy.toml lacks `{key}`");
        }
    }
    let sync_paths = disallowed(&first);
    assert_eq!(sync_paths.iter().collect::<Vec<_>>(), want, "sync bans must be the async bans minus std::fs/std::net");
    let out = clippy_fixture(&root.join("crates/parse"), "sync")?;
    for p in &sync_paths {
        assert!(reported(&out, p), "{p} not reported with the sync config:\n{out}");
    }
    for p in async_paths.iter().filter(|p| p.starts_with("std::fs::") || p.starts_with("std::net::")) {
        assert!(!reported(&out, p), "{p} is reported in a sync crate:\n{out}");
    }
    Ok(())
}

/// Every file under the repo root as a `/`-separated relative path, outside fixtures, build output,
/// dependencies, git, the private corpus and `.claude/` (which holds other worktrees).
fn repo_files() -> Result<Vec<String>, String> {
    const SKIP: [&str; 9] =
        [".git", ".claude", "target", "node_modules", "fixtures", "private", "dist", ".verify", ".evidence"];
    let root = repo_root();
    let mut out = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).map_err(|e| format!("{}: {e}", d.display()))? {
            let p = e.map_err(|e| e.to_string())?.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if p.is_dir() {
                if !SKIP.contains(&name) {
                    stack.push(p);
                }
            } else {
                out.push(p.strip_prefix(&root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out.sort();
    Ok(out)
}

#[test]
fn no_other_crate_overrides_the_root_clippy_toml() -> Result<(), String> {
    let files = repo_files()?;
    // Clippy uses the nearest config folder and prefers .clippy.toml over clippy.toml in it, so any
    // other file (a root .clippy.toml included) would replace the root bans.
    let found: Vec<&str> = files
        .iter()
        .map(String::as_str)
        .filter(|f| matches!(f.rsplit('/').next(), Some("clippy.toml" | ".clippy.toml")))
        .collect();
    let mut want = vec!["clippy.toml".to_string()];
    want.extend(SYNC_CRATES.iter().map(|c| format!("crates/{c}/clippy.toml")));
    want.sort();
    assert_eq!(found, want, "only the root and the sync crates may carry a clippy config");
    // CLIPPY_CONF_DIR in a cargo config's [env] would point every crate at another file.
    let cargo_configs = files.iter().filter(|f| {
        let mut parts = f.rsplit('/');
        matches!(parts.next(), Some("config" | "config.toml")) && parts.next() == Some(".cargo")
    });
    for f in cargo_configs {
        let text = read(&repo_root().join(f))?;
        assert!(!text.contains("CLIPPY_CONF_DIR"), "{f} sets CLIPPY_CONF_DIR, which bypasses clippy.toml");
    }
    Ok(())
}

#[test]
fn check_arch_passes_on_the_workspace_and_fails_on_a_core_to_ai_edge() -> Result<(), String> {
    let root = repo_root();
    let script = root.join("scripts/check_arch.py");
    let real = run(py()?.arg(&script).arg("--root").arg(&root))?;
    assert!(
        real.status.success() && text(&real).contains("ARCH OK"),
        "check_arch fails on the workspace:\n{}",
        text(&real)
    );

    let ws = Scratch::new("arch")?;
    for rel in ["Cargo.toml", "clippy.toml", "app/Cargo.toml", "tests/fake-provider/Cargo.toml"] {
        write(&ws.0.join(rel), &read(&root.join(rel))?)?;
    }
    for e in std::fs::read_dir(root.join("crates")).map_err(|e| e.to_string())? {
        let dir = e.map_err(|e| e.to_string())?.path();
        if dir.join("Cargo.toml").is_file() {
            let rel = dir.strip_prefix(&root).map_err(|e| e.to_string())?.join("Cargo.toml");
            write(&ws.0.join(&rel), &read(&root.join(&rel))?)?;
        }
    }
    let core = ws.0.join("crates/core/Cargo.toml");
    let edge = "lecter-ai = { path = \"../ai\" }\n";
    let manifest = read(&core)?;
    let manifest = match manifest.find("\n[dependencies]\n") {
        Some(i) => format!(
            "{}{edge}{}",
            &manifest[..i + "\n[dependencies]\n".len()],
            &manifest[i + "\n[dependencies]\n".len()..]
        ),
        None => format!("{manifest}\n[dependencies]\n{edge}"),
    };
    write(&core, &manifest)?;
    let bad = run(py()?.arg(&script).arg("--root").arg(&ws.0))?;
    assert!(!bad.status.success(), "check_arch passed a core → ai edge:\n{}", text(&bad));
    assert!(text(&bad).contains("lecter-core → lecter-ai"), "wrong failure:\n{}", text(&bad));
    Ok(())
}

#[test]
fn check_size_passes_on_the_scaffold_and_fails_past_500_lines() -> Result<(), String> {
    let root = repo_root();
    let script = root.join("scripts/check_size.py");
    let real = run(py()?.arg(&script).arg("--root").arg(&root))?;
    assert!(real.status.success(), "check_size fails on the scaffold:\n{}", text(&real));

    let ws = Scratch::new("size")?;
    let body = |n: usize| "x\n".repeat(n);
    for (rel, n) in [
        ("crates/x/src/long.rs", 501),
        ("ui/src/long.ts", 501),
        ("ui/src/Long.tsx", 501),
        ("ui/src/Ok.tsx", 500),
        ("crates/x/src/ok.rs", 500),
        ("ui/src/core/bindings.ts", 2000),
    ] {
        write(&ws.0.join(rel), &body(n))?;
    }
    let out = run(py()?.arg(&script).arg("--root").arg(&ws.0))?;
    let report = text(&out);
    assert!(!out.status.success(), "check_size passed 501-line files:\n{report}");
    for long in ["crates/x/src/long.rs", "ui/src/long.ts", "ui/src/Long.tsx"] {
        assert!(report.contains(&format!("{long}: 501 lines")), "{long} not reported:\n{report}");
    }
    for fine in ["Ok.tsx", "ok.rs", "bindings.ts"] {
        assert!(!report.contains(fine), "{fine} wrongly reported:\n{report}");
    }
    Ok(())
}
