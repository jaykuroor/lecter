//! `lecter-harness prompt <lecture> <block|note> <question…>`: prints the request that asking
//! `question` with Enter on a slide block (`s3b2`) or own note (`n-91c0`) of the lecture file
//! `lecture` sends to the provider, as JSON: the same `ChatRequest` the app's `gloss_request`
//! assembles, for the sample provider's model (F-023, F-048).
//! The lecture's course must be trusted (`course trust <dir> trusted`); a read-only or unanswered
//! course is `E_NOT_TRUSTED`, as in the app (F-033, SEC-27).

use std::path::Path;

use lecter_ai::provider::scripted::SAMPLE_ID;
use lecter_core::lecture;

use super::{Command, Reply, gate};
use crate::error::{ErrorCode, HarnessError};

/// The `prompt` command.
pub const COMMAND: Command = Command {
    name: "prompt",
    summary: "prompt <lecture> <block|note> <question…>: print the request Enter (ask) on that line sends",
    run,
};

const USAGE: &str = "usage: prompt <lecture> <block|note> <question…>";

fn run(args: &[String]) -> Result<Reply, HarnessError> {
    let [lecture, block, words @ ..] = args else {
        return Err(HarnessError::invalid_argument(format!("missing lecture file or block id; {USAGE}")));
    };
    if words.is_empty() {
        return Err(HarnessError::invalid_argument(format!("missing question; {USAGE}")));
    }
    let text = read_lecture(Path::new(lecture))?;
    let req = lecter_ai::prompt::ask_request(&text, block, &words.join(" "), SAMPLE_ID).map_err(|e| match e {
        lecter_ai::Error::BlockNotFound => {
            let what = if block.starts_with("n-") { "note" } else { "block" };
            HarnessError::new(ErrorCode::NotFound, format!("no {what} {block} in {lecture}"))
        }
        e => HarnessError::invalid_argument(e.to_string()),
    })?;
    let json = serde_json::to_value(&req)
        .map_err(|_| HarnessError::new(ErrorCode::Internal, "the request could not be written as JSON"))?;
    let text = serde_json::to_string_pretty(&json)
        .map_err(|_| HarnessError::new(ErrorCode::Internal, "the request could not be written as JSON"))?;
    Ok(Reply { json, text })
}

/// The lecture file's text, read as the app opens it (`lecture::open`: a `.md` file directly in a
/// course's `lectures/`, at most the lecture size limit, UTF-8). A prompt is what the AI receives,
/// so the course must be trusted as it is now (SEC-27); otherwise `E_NOT_TRUSTED`.
fn read_lecture(path: &Path) -> Result<String, HarnessError> {
    let shown = path.display();
    let abs = std::path::absolute(path).map_err(|_| {
        HarnessError::invalid_argument("the lecture path can't be made absolute (no working directory?)")
    })?;
    if std::fs::symlink_metadata(&abs).is_err() {
        return Err(HarnessError::new(ErrorCode::NotFound, format!("{shown} does not exist")));
    }
    let name = abs.file_name().and_then(|n| n.to_str());
    let folder = abs.parent().filter(|d| d.file_name().is_some_and(|n| n == "lectures"));
    let (Some(name), Some(course)) = (name, folder.and_then(Path::parent)) else {
        return Err(HarnessError::new(
            ErrorCode::NotTrusted,
            format!("{shown} is not in a course's lectures/ folder, so no trusted course holds it"),
        ));
    };
    gate::require_trusted(course)?;
    lecture::open(course, &format!("lectures/{name}")).map(|l| l.text).map_err(gate::core_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(args: &[&str]) -> Result<Reply, HarnessError> {
        run(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn a_lecture_a_block_and_a_question_are_required() {
        for args in [&[][..], &["l.md"][..], &["l.md", "s1b1"][..]] {
            let e = call(args).err().unwrap_or_else(|| panic!("{args:?} was accepted"));
            assert_eq!(e.code, ErrorCode::InvalidArgument, "{args:?}");
            assert!(e.message.contains(USAGE), "{args:?}: {}", e.message);
        }
    }

    #[test]
    fn a_missing_lecture_file_is_not_found() {
        let e = call(&["no/such/lecture.md", "s1b1", "why?"]).err().unwrap_or_else(|| panic!("accepted"));
        assert_eq!(e.code, ErrorCode::NotFound);
    }
}
