//! Shape and behaviour checks for `.github/workflows/nightly.yml` (F-178,
//! `16-ci-cd.md#nightlyyml-0300-utc-daily-plus-manual-dispatch`). The YAML is read as text
//! (`workflow/mod.rs`); the skip-check script is run under bash with a stub `gh` on PATH.

mod common;
mod workflow;
use workflow::{job, read, value};

const NIGHTLY: &str = ".github/workflows/nightly.yml";
const SKIP_IF: &str = "if: needs.skip-check.outputs.skip != 'true'";

/// Job ids under `jobs:`, in order.
fn job_ids(text: &str) -> Vec<&str> {
    let Some((_, jobs)) = text.split_once("\njobs:\n") else { return Vec::new() };
    jobs.lines()
        .filter(|l| l.starts_with("  ") && !l.starts_with("   ") && !l.trim_start().starts_with('#'))
        .filter_map(|l| l.trim().strip_suffix(':'))
        .collect()
}

#[test]
fn nightly_runs_at_three_utc_and_on_dispatch_with_least_privilege() -> Result<(), String> {
    let n = read(NIGHTLY)?;
    let (on, _) = n.split_once("\npermissions:\n").ok_or("nightly.yml has no top-level permissions")?;
    let cron = value(on, "- cron").ok_or("nightly.yml has no schedule cron")?;
    assert_eq!(cron.trim_matches(|c| c == '"' || c == '\''), "0 3 * * *", "nightly must run at 03:00 UTC");
    assert!(on.contains("\n  schedule:\n"), "the cron must sit under on.schedule");
    assert!(on.contains("\n  workflow_dispatch:"), "nightly must also run on workflow_dispatch");
    assert!(!n.contains("pull_request"), "nightly runs on schedule and dispatch only");
    assert!(!n.contains("secrets."), "nightly needs no secrets");
    let skip = job(&n, "skip-check").ok_or("nightly.yml has no `skip-check` job")?;
    assert!(
        skip.contains("\n    permissions:\n      contents: read\n      actions: read\n"),
        "skip-check alone adds `actions: read` to the read-only default"
    );
    for id in job_ids(&n).into_iter().filter(|id| *id != "skip-check") {
        let body = job(&n, id).ok_or(format!("job `{id}` not found"))?;
        assert!(!body.contains("actions: read"), "job `{id}` must not widen permissions");
    }
    Ok(())
}

#[test]
fn every_other_job_waits_for_skip_check_and_is_skipped_by_it() -> Result<(), String> {
    let n = read(NIGHTLY)?;
    let ids = job_ids(&n);
    assert_eq!(ids.first(), Some(&"skip-check"), "skip-check must be the first job");
    assert!(ids.len() >= 2, "nightly has no job besides skip-check: {ids:?}");
    let skip = job(&n, "skip-check").ok_or("no skip-check job")?;
    assert_eq!(value(skip, "skip"), Some("${{ steps.last.outputs.skip }}"), "skip-check's `skip` output");
    for id in ids.into_iter().skip(1) {
        let body = job(&n, id).ok_or(format!("job `{id}` not found"))?;
        let needs = body.lines().find_map(|l| l.strip_prefix("    needs:")).unwrap_or("");
        assert!(needs.contains("skip-check"), "job `{id}` must need skip-check, needs `{needs}`");
        assert!(body.lines().any(|l| l == format!("    {SKIP_IF}")), "job `{id}` must be skipped by skip-check");
    }
    Ok(())
}

#[test]
fn mutants_job_runs_the_full_tree_and_uploads_the_score() -> Result<(), String> {
    let n = read(NIGHTLY)?;
    let m = job(&n, "mutants").ok_or("nightly.yml has no `mutants` job")?;
    assert_eq!(value(m, "runs-on"), Some("ubuntu-24.04"));
    assert_eq!(value(m, "timeout-minutes"), Some("150"));
    // Exactly the script call: mutants.py --full exits 0 with survivors (scripts/tests/test_mutants.py),
    // so nothing may turn survivors into a failure, and nothing may hide a crash of the script.
    let runs: Vec<&str> = m.lines().filter_map(|l| l.trim().strip_prefix("run: ")).collect();
    assert!(runs.contains(&"python3 scripts/mutants.py --full --minutes 120"), "mutants runs: {runs:?}");
    assert!(!m.contains("continue-on-error"), "a crash of mutants.py must still show as a failure");
    // cargo-mutants prebuilt from the pinned install-action, before Setup (init.sh would compile it).
    let install = m.find("uses: taiki-e/install-action@").ok_or("no taiki-e/install-action step")?;
    let tool =
        m[install..].lines().find_map(|l| l.trim().strip_prefix("tool: ")).ok_or("install-action has no tool")?;
    assert_eq!(tool, "cargo-mutants");
    let setup = m.find("uses: ./.github/actions/setup").ok_or("mutants does not use the shared Setup")?;
    assert!(install < setup, "cargo-mutants must be installed before Setup runs init.sh");
    let upload = &m[m.find("uses: actions/upload-artifact@").ok_or("mutants uploads nothing")?..];
    assert_eq!(value(upload, "name"), Some("mutants"));
    for p in [".verify/mutants/score.json", ".verify/mutants/survivors.txt"] {
        assert!(upload.lines().any(|l| l.trim() == p), "the mutants artifact lacks {p}");
    }
    assert_eq!(value(upload, "include-hidden-files"), Some("true"), ".verify/ is a hidden folder");
    assert_eq!(value(upload, "if-no-files-found"), Some("error"), "a missing score must fail the upload");
    Ok(())
}

#[cfg(unix)]
mod skip_check {
    use super::*;
    use std::process::Command;

    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";

    /// The first `run: |` block in `body` that contains `marker`, dedented.
    fn run_block(body: &str, marker: &str) -> Option<String> {
        let lines: Vec<&str> = body.lines().collect();
        for (at, head) in lines.iter().enumerate().filter(|(_, l)| l.trim() == "run: |") {
            let indent = head.len() - head.trim_start().len();
            let (mut out, mut strip) = (String::new(), None);
            for l in &lines[at + 1..] {
                let i = l.len() - l.trim_start().len();
                if !l.trim().is_empty() && i <= indent {
                    break;
                }
                let s = *strip.get_or_insert(i);
                out.push_str(l.get(s..).unwrap_or(""));
                out.push('\n');
            }
            if out.contains(marker) {
                return Some(out);
            }
        }
        None
    }

    /// Runs skip-check's script as Actions would (`bash -eo pipefail`) with a stub `gh` that prints
    /// `gh_out` and exits `gh_exit`. Returns (exit code, `skip` output, gh's arguments).
    fn run(gh_out: &str, gh_exit: i32) -> Result<(i32, String, String), String> {
        let n = read(NIGHTLY)?;
        let body = job(&n, "skip-check").ok_or("no skip-check job")?;
        let script = run_block(body, "gh api").ok_or("skip-check has no `run: |` script calling gh api")?;
        let stub = format!("printf '%s\\n' \"$@\" > \"$TMPDIR/gh-args\"\nprintf '%s\\n' '{gh_out}'\nexit {gh_exit}");
        let dir = common::bare_path(&[("gh", &stub)])?;
        let d = dir.path();
        std::fs::write(d.join("script.sh"), script).map_err(|e| e.to_string())?;
        let out = Command::new(d.join("bash"))
            .args(["--noprofile", "--norc", "-eo", "pipefail"])
            .arg(d.join("script.sh"))
            .env_clear()
            .env("PATH", d)
            .env("TMPDIR", d)
            .env("HOME", d)
            .env("GH_TOKEN", "token")
            .env("GITHUB_REPOSITORY", "owner/lecter")
            .env("GITHUB_SHA", SHA)
            .env("GITHUB_WORKFLOW_REF", "owner/lecter/.github/workflows/nightly.yml@refs/heads/main")
            .env("GITHUB_OUTPUT", d.join("out"))
            .output()
            .map_err(|e| e.to_string())?;
        let outputs = std::fs::read_to_string(d.join("out")).unwrap_or_default();
        let skip = outputs.lines().find_map(|l| l.strip_prefix("skip=")).unwrap_or("<unset>").to_string();
        let args = std::fs::read_to_string(d.join("gh-args")).unwrap_or_default();
        Ok((out.status.code().unwrap_or(-1), skip, args))
    }

    #[test]
    fn skips_when_the_newest_successful_nightly_ran_on_this_commit() -> Result<(), String> {
        let (code, skip, args) = run(SHA, 0)?;
        assert_eq!((code, skip.as_str()), (0, "true"));
        let query = args.lines().find(|a| a.contains("/runs")).ok_or(format!("gh api had no runs query: {args}"))?;
        assert!(query.starts_with("repos/owner/lecter/actions/workflows/nightly.yml/runs?"), "query: {query}");
        assert!(query.contains("status=success"), "only successful runs count: {query}");
        assert!(query.contains("per_page=1"), "the newest run only: {query}");
        assert!(args.contains("head_sha"), "the run's head SHA is compared: {args}");
        Ok(())
    }

    #[test]
    fn runs_when_the_last_success_was_another_commit_or_there_is_none() -> Result<(), String> {
        for prev in ["fedcba9876543210fedcba9876543210fedcba98", "", "0123456789abcdef0123456789abcdef0123456"] {
            let (code, skip, _) = run(prev, 0)?;
            assert_eq!((code, skip.as_str()), (0, "false"), "previous success on `{prev}`");
        }
        Ok(())
    }

    #[test]
    fn runs_when_the_api_call_fails() -> Result<(), String> {
        let (code, skip, _) = run("", 1)?;
        assert_eq!((code, skip.as_str()), (0, "false"), "an API error must not skip the nightly");
        Ok(())
    }
}
