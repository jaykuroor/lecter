//! `lecter-harness prompt <lecture> <block> <question…>`: prints the request that asking
//! `question` about `block` of the lecture file `lecture` sends to the provider, as JSON: the same
//! `ChatRequest` the app's `gloss_request` assembles, for the sample provider's model (F-023).

use std::io::Read;
use std::path::Path;

use lecter_ai::provider::scripted::SAMPLE_ID;
use lecter_core::lecture::MAX_LECTURE_BYTES;

use super::{Command, Reply};
use crate::error::{ErrorCode, HarnessError};

/// The `prompt` command.
pub const COMMAND: Command = Command {
    name: "prompt",
    summary: "prompt <lecture> <block> <question…>: print the request a gloss on that block sends",
    run,
};

const USAGE: &str = "usage: prompt <lecture> <block> <question…>";

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
            HarnessError::new(ErrorCode::NotFound, format!("no block {block} in {lecture}"))
        }
        e => HarnessError::invalid_argument(e.to_string()),
    })?;
    let json = serde_json::to_value(&req)
        .map_err(|_| HarnessError::new(ErrorCode::Internal, "the request could not be written as JSON"))?;
    let text = serde_json::to_string_pretty(&json)
        .map_err(|_| HarnessError::new(ErrorCode::Internal, "the request could not be written as JSON"))?;
    Ok(Reply { json, text })
}

/// The lecture file as UTF-8, read up to the app's lecture size limit.
fn read_lecture(path: &Path) -> Result<String, HarnessError> {
    let shown = path.display();
    let file = std::fs::File::open(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => HarnessError::new(ErrorCode::NotFound, format!("{shown} does not exist")),
        _ => HarnessError::new(ErrorCode::Io, format!("{shown} could not be read")),
    })?;
    let mut bytes = Vec::new();
    file.take(MAX_LECTURE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| HarnessError::new(ErrorCode::Io, format!("{shown} could not be read")))?;
    if bytes.len() as u64 > MAX_LECTURE_BYTES {
        return Err(HarnessError::invalid_argument(format!("{shown} is larger than a lecture may be")));
    }
    String::from_utf8(bytes).map_err(|_| HarnessError::invalid_argument(format!("{shown} is not UTF-8 text")))
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
