//! Text helpers shared by the workflow shape tests (`ci.rs`, `nightly.rs`). The YAML is read as
//! text: the shapes checked are simple enough that a parser dependency would cost more than it proves.

use std::path::{Path, PathBuf};

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn read(rel: &str) -> Result<String, String> {
    std::fs::read_to_string(repo_root().join(rel)).map_err(|e| format!("{rel}: {e}"))
}

/// The text of one job under `jobs:` (two-space indent), up to the next job.
pub fn job<'a>(workflow: &'a str, name: &str) -> Option<&'a str> {
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

/// The value of `key: <value>` on a line of `body`, trimmed.
pub fn value<'a>(body: &'a str, key: &str) -> Option<&'a str> {
    body.lines().find_map(|l| l.trim().strip_prefix(key)?.strip_prefix(':').map(str::trim))
}
