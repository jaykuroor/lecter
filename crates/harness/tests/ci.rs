//! Repository-shape checks for the CI workflows, Dependabot and `scripts/init.sh` (F-013,
//! `16-ci-cd.md`). The YAML is read as text: the shapes checked here are simple enough that a
//! parser dependency would cost more than it proves.

use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(rel: &str) -> Result<String, String> {
    std::fs::read_to_string(repo_root().join(rel)).map_err(|e| format!("{rel}: {e}"))
}

/// Every `*.yml` under a folder of `.github/`, as (relative path, text).
fn yaml_files(dir: &str) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    let mut stack = vec![repo_root().join(dir)];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).map_err(|e| format!("{}: {e}", d.display()))? {
            let p = e.map_err(|e| e.to_string())?.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "yml" || x == "yaml") {
                let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
                out.push((p.display().to_string(), text));
            }
        }
    }
    if out.is_empty() {
        return Err(format!("no YAML files under {dir}"));
    }
    Ok(out)
}

/// The text of one job under `jobs:` (two-space indent), up to the next job.
fn job<'a>(workflow: &'a str, name: &str) -> Option<&'a str> {
    let header = format!("\n  {name}:\n");
    let start = workflow.find(&header)? + header.len();
    let rest = &workflow[start..];
    // The job ends at the first non-blank, non-comment line indented by two spaces or less.
    let mut end = 0;
    for line in rest.split_inclusive('\n') {
        let indent = line.len() - line.trim_start_matches(' ').len();
        let blank = line.trim().is_empty() || line.trim_start().starts_with('#');
        if !blank && indent <= 2 {
            break;
        }
        end += line.len();
    }
    Some(&rest[..end])
}

/// Top-level keys of a YAML file, in order.
fn top_level_keys(text: &str) -> Vec<&str> {
    text.lines()
        .filter(|l| !l.is_empty() && !l.starts_with(' ') && !l.starts_with('#'))
        .filter_map(|l| l.split_once(':').map(|(k, _)| k.trim()))
        .collect()
}

#[test]
fn ci_yml_has_lint_test_and_e2e_jobs_that_call_verify_stages() -> Result<(), String> {
    let ci = read(".github/workflows/ci.yml")?;
    for (name, runners) in [
        ("lint", &["ubuntu-24.04"][..]),
        ("test", &["ubuntu-24.04", "macos-15", "windows-2025"]),
        ("e2e", &["ubuntu-24.04"]),
    ] {
        let body = job(&ci, name).ok_or(format!("ci.yml has no `{name}` job"))?;
        let call = format!("scripts/verify.sh --stage {name}");
        if !body.contains(&call) {
            return Err(format!("job `{name}` does not run `{call}`"));
        }
        for r in runners {
            if !body.contains(r) {
                return Err(format!("job `{name}` does not run on {r}"));
            }
        }
        if body.contains("name:") && body.lines().any(|l| l.starts_with("    name:")) {
            return Err(format!(
                "job `{name}` overrides its name; status checks rely on the job id (16-ci-cd.md#rules)"
            ));
        }
    }
    let test = job(&ci, "test").ok_or("no test job")?;
    if !test.contains("matrix:") || !test.contains("runs-on: ${{ matrix.os }}") {
        return Err("job `test` must run on a matrix of the three OSes".into());
    }
    Ok(())
}

#[test]
fn ci_yml_triggers_on_main_pull_requests_and_dispatch() -> Result<(), String> {
    let ci = read(".github/workflows/ci.yml")?;
    for needle in ["push:", "branches: [main]", "pull_request:", "workflow_dispatch:"] {
        if !ci.contains(needle) {
            return Err(format!("ci.yml `on:` lacks `{needle}`"));
        }
    }
    Ok(())
}

#[test]
fn every_workflow_starts_with_read_only_contents_permission() -> Result<(), String> {
    for (path, text) in yaml_files(".github/workflows")? {
        let keys = top_level_keys(&text);
        let first_real = keys.iter().copied().find(|k| *k != "name" && *k != "on" && *k != "\"on\"");
        if first_real != Some("permissions") {
            return Err(format!("{path}: the first key after name/on must be `permissions`, got {first_real:?}"));
        }
        if !text.contains("\npermissions:\n  contents: read\n") {
            return Err(format!("{path}: top-level permissions must be exactly `contents: read`"));
        }
        if text.contains(": write") {
            return Err(format!("{path}: widens a permission to write; no ci.yml job needs it"));
        }
    }
    Ok(())
}

fn is_pinned(uses: &str) -> bool {
    // owner/repo[/path]@<40-hex sha> # v<version>
    let Some((target, rest)) = uses.split_once('@') else { return false };
    let mut parts = rest.splitn(2, ' ');
    let sha = parts.next().unwrap_or("");
    let comment = parts.next().unwrap_or("").trim();
    target.contains('/')
        && sha.len() == 40
        && sha.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && comment.starts_with("# v")
        && comment[3..].starts_with(|c: char| c.is_ascii_digit())
}

#[test]
fn third_party_actions_are_pinned_by_sha_with_the_version_in_a_comment() -> Result<(), String> {
    let mut seen = 0;
    for (path, text) in yaml_files(".github")? {
        for line in text.lines() {
            let t = line.trim().trim_start_matches("- ");
            let Some(uses) = t.strip_prefix("uses:") else { continue };
            let uses = uses.trim();
            if uses.starts_with("./") {
                continue; // a local action in this repository
            }
            seen += 1;
            if !is_pinned(uses) {
                return Err(format!("{path}: `{uses}` is not pinned as owner/repo@<sha> # v<version>"));
            }
        }
    }
    if seen == 0 {
        return Err("no third-party actions found; the setup steps are missing".into());
    }
    Ok(())
}

#[test]
fn pin_check_rejects_tags_and_short_shas() {
    assert!(is_pinned("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1"));
    assert!(!is_pinned("actions/checkout@v7"));
    assert!(!is_pinned("actions/checkout@3d3c42e # v7.0.1"));
    assert!(!is_pinned("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"));
}

/// ci.yml plus the local actions it uses, since the setup steps live in a composite action.
fn ci_with_local_actions() -> Result<String, String> {
    let mut all = read(".github/workflows/ci.yml")?;
    if let Ok(actions) = yaml_files(".github/actions") {
        for (_, t) in actions {
            all.push_str(&t);
        }
    }
    Ok(all)
}

#[test]
fn ci_yml_uses_the_spec_concurrency_group() -> Result<(), String> {
    let ci = read(".github/workflows/ci.yml")?;
    // The spec writes it as a one-line flow mapping, which YAML rejects (`${{` inside `{ }`); the
    // block form carries exactly the same group and cancel rule.
    let want = "\nconcurrency:\n  group: ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n";
    if !ci.contains(want) {
        return Err(format!("ci.yml lacks the concurrency block{want}"));
    }
    Ok(())
}

#[test]
fn ci_setup_caches_rust_and_pnpm_and_installs_the_cargo_tools() -> Result<(), String> {
    let all = ci_with_local_actions()?;
    let checks = [
        ("Swatinem/rust-cache@", "the Rust cache"),
        ("cache: pnpm", "the pnpm store cache"),
        ("cache-dependency-path: ui/pnpm-lock.yaml", "the pnpm cache key"),
        ("taiki-e/install-action@", "prebuilt cargo tools"),
        ("cargo-nextest", "cargo-nextest"),
        ("cargo-deny", "cargo-deny"),
        ("scripts/init.sh", "the install step"),
        ("rust-toolchain.toml", "the Rust toolchain from rust-toolchain.toml"),
        ("package_json_file: ui/package.json", "pnpm from ui/package.json"),
        ("node-version-file: ui/package.json", "Node from ui/package.json"),
    ];
    for (needle, what) in checks {
        if !all.contains(needle) {
            return Err(format!("CI setup lacks {what} (`{needle}`)"));
        }
    }
    Ok(())
}

#[test]
fn ci_installs_a_pinned_checksum_verified_gitleaks() -> Result<(), String> {
    let all = ci_with_local_actions()?;
    if !all.contains(".github/scripts/install-gitleaks.sh") {
        return Err("CI setup does not run .github/scripts/install-gitleaks.sh".into());
    }
    let script = read(".github/scripts/install-gitleaks.sh")?;
    let version =
        script.lines().find_map(|l| l.strip_prefix("VERSION=")).ok_or("install-gitleaks.sh has no VERSION=")?;
    if !version.chars().all(|c| c.is_ascii_digit() || c == '.') || version.split('.').count() != 3 {
        return Err(format!("gitleaks VERSION must be an exact x.y.z, got {version}"));
    }
    for asset in ["linux_x64.tar.gz", "darwin_arm64.tar.gz", "windows_x64.zip"] {
        let line = script.lines().find(|l| l.contains(asset)).ok_or(format!("no checksum for {asset}"))?;
        let has_sha = line
            .split(|c: char| !c.is_ascii_hexdigit())
            .any(|w| w.len() == 64 && w.bytes().all(|b| !b.is_ascii_uppercase()));
        if !has_sha {
            return Err(format!("{asset}: no 64-hex SHA-256 on its line"));
        }
    }
    if !(script.contains("sha256sum") && script.contains("shasum -a 256")) || !script.contains("exit 1") {
        return Err("install-gitleaks.sh must verify the SHA-256 (sha256sum or shasum) and fail on mismatch".into());
    }
    // GNU sha256sum prefixes its line with `\` when the file name holds a backslash (Windows
    // $RUNNER_TEMP), which broke the compare on windows (CI-5e897b2). Hash stdin, never a path.
    if let Some(line) = script.lines().find(|l| l.contains("sha256sum \"") || l.contains("shasum -a 256 \"")) {
        return Err(format!("install-gitleaks.sh must hash stdin (`sha256sum < \"$f\"`), not a path: {line}"));
    }
    Ok(())
}

#[test]
fn ci_windows_steps_use_bash() -> Result<(), String> {
    let ci = read(".github/workflows/ci.yml")?;
    if !ci.contains("defaults:\n  run:\n    shell: bash\n") {
        return Err("ci.yml must default every run step to `shell: bash` (Git Bash on Windows)".into());
    }
    Ok(())
}

#[test]
fn e2e_installs_both_browsers_and_uploads_traces_on_failure() -> Result<(), String> {
    let ci = read(".github/workflows/ci.yml")?;
    let e2e = job(&ci, "e2e").ok_or("no e2e job")?;
    for needle in
        ["playwright install", "chromium", "webkit", "if: failure()", "actions/upload-artifact@", "test-results"]
    {
        if !e2e.contains(needle) {
            return Err(format!("e2e job lacks `{needle}`"));
        }
    }
    Ok(())
}

#[test]
fn dependabot_groups_weekly_updates_with_three_open_prs_each() -> Result<(), String> {
    let d = read(".github/dependabot.yml")?;
    if !d.contains("version: 2") {
        return Err("dependabot.yml must be version 2".into());
    }
    let blocks: Vec<&str> = d.split("  - package-ecosystem:").skip(1).collect();
    let want = [("github-actions", "\"/\""), ("cargo", "\"/\""), ("npm", "\"/ui\"")];
    if blocks.len() != want.len() {
        return Err(format!("expected {} ecosystems, found {}", want.len(), blocks.len()));
    }
    for (eco, dir) in want {
        let b = blocks
            .iter()
            .find(|b| {
                b.trim_start().trim_matches('"').starts_with(eco)
                    && b.lines().next().is_some_and(|l| l.trim().trim_matches('"') == eco)
            })
            .ok_or(format!("no `{eco}` ecosystem"))?;
        for needle in [
            format!("directory: {dir}"),
            "interval: weekly".into(),
            "open-pull-requests-limit: 3".into(),
            "groups:".into(),
            "patterns: [\"*\"]".into(),
        ] {
            if !b.contains(&needle) {
                return Err(format!("dependabot `{eco}` lacks `{needle}`"));
            }
        }
    }
    Ok(())
}

/// A PATH holding only the basic tools init.sh needs to run, so every developer tool is "missing".
#[cfg(unix)]
fn bare_path(extra: &[(&str, &str)]) -> Result<tempdir::Dir, String> {
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

#[cfg(unix)]
fn init_check(path: &Path, fallback: &Path) -> Result<(i32, String), String> {
    let out = Command::new(path.join("bash"))
        .arg(repo_root().join("scripts/init.sh"))
        .arg("--check")
        .env_clear()
        .env("PATH", path)
        .env("HOME", path)
        .env("TMPDIR", path)
        .env("LECTER_NODE_FALLBACK", fallback)
        .output()
        .map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok((out.status.code().unwrap_or(-1), text))
}

#[cfg(unix)]
#[test]
fn init_check_lists_each_missing_tool_with_a_fedora_install_command() -> Result<(), String> {
    let dir = bare_path(&[])?;
    let (code, out) = init_check(dir.path(), &dir.path().join("no-node-24"))?;
    if code != 1 {
        return Err(format!("init.sh --check should exit 1 with tools missing, got {code}:\n{out}"));
    }
    let listed: Vec<&str> = out.lines().filter(|l| l.starts_with("  - ")).collect();
    for tool in ["git ", "python3 ", "cargo ", "node ", "pnpm ", "gitleaks ", "cargo-nextest ", "cargo-deny "] {
        let line = listed.iter().find(|l| l[4..].starts_with(tool)).ok_or(format!("`{tool}` not listed:\n{out}"))?;
        if !(line.contains("sudo dnf install") || line.contains("cargo install") || line.contains("npm install")) {
            return Err(format!("no Fedora install command on: {line}"));
        }
    }
    for line in &listed {
        if !line.contains("sudo dnf ") && !line.contains("cargo install") && !line.contains("npm install") {
            return Err(format!("no Fedora install command on: {line}"));
        }
    }
    Ok(())
}

#[cfg(unix)]
#[test]
fn init_check_wants_the_pinned_node_and_falls_back_to_node_24() -> Result<(), String> {
    let want = read("ui/package.json")?
        .lines()
        .find_map(|l| {
            l.trim().strip_prefix("\"node\": \"").map(|v| v.trim_end_matches(['"', ','].as_ref()).to_string())
        })
        .ok_or("ui/package.json has no engines.node")?;
    let old = bare_path(&[("node", "echo v22.23.1")])?;
    let (_, out) = init_check(old.path(), &old.path().join("no-node-24"))?;
    let node = out.lines().find(|l| l.starts_with("  - node ")).ok_or(format!("node 22 not reported:\n{out}"))?;
    if !node.contains(&want) || !node.contains("sudo dnf install nodejs24") {
        return Err(format!("node line should name {want} and the dnf command: {node}"));
    }
    let with_fb = bare_path(&[("node", "echo v22.23.1"), ("node-24", &format!("echo v{want}"))])?;
    let (_, out) = init_check(with_fb.path(), &with_fb.path().join("node-24"))?;
    if out.lines().any(|l| l.starts_with("  - node ")) {
        return Err(format!("node listed as missing although the fallback is {want}:\n{out}"));
    }
    if !out.contains(&format!("node: using {}", with_fb.path().join("node-24").display())) {
        return Err(format!("init.sh --check should say it uses the fallback:\n{out}"));
    }
    Ok(())
}

#[cfg(unix)]
#[test]
fn init_replaces_a_node_link_that_points_somewhere_else() -> Result<(), String> {
    let want = "24.18.0";
    let dir = bare_path(&[
        ("node", "echo v22.23.1"),
        ("node-24", &format!("echo v{want}")),
        ("planted", &format!("echo v{want}")),
    ])?;
    // HOME is the bare dir, so the link lives in <dir>/.cache/lecter/node-v<want>; plant a wrong one there.
    let shim = dir.path().join(format!(".cache/lecter/node-v{want}"));
    std::fs::create_dir_all(&shim).map_err(|e| e.to_string())?;
    std::os::unix::fs::symlink(dir.path().join("planted"), shim.join("node")).map_err(|e| e.to_string())?;
    let fallback = dir.path().join("node-24");
    let (_, out) = init_check(dir.path(), &fallback)?;
    let target = std::fs::read_link(shim.join("node")).map_err(|e| e.to_string())?;
    if target != fallback {
        return Err(format!("the planted link was kept ({}):\n{out}", target.display()));
    }
    Ok(())
}

/// A temporary directory removed on drop (std only; no tempfile dependency for two tests).
#[cfg(unix)]
mod tempdir {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    pub struct Dir(PathBuf);

    impl Dir {
        pub fn new() -> Result<Self, String> {
            let n = N.fetch_add(1, Ordering::Relaxed);
            let p = std::env::temp_dir().join(format!("lecter-ci-test-{}-{n}", std::process::id()));
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
