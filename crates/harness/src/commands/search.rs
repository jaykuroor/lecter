//! `lecter-harness search <dir> <words…>`: opens the course folder, indexes each of its lectures
//! as opening it in the app does, and prints the hits for the words as JSON: the same `Hit`s, best
//! first and at most `MAX_HITS`, as the app's `search_find` (F-022).

use std::path::Path;

use lecter_core::{course, lecture};
use lecter_index::{CourseIndex, Hit, MAX_HITS};

use super::{Command, Reply};
use crate::error::{ErrorCode, HarnessError};

/// The `search` command.
pub const COMMAND: Command =
    Command { name: "search", summary: "search <dir> <words…>: index a course's lectures and list the hits", run };

const USAGE: &str = "usage: search <dir> <words…>";

fn run(args: &[String]) -> Result<Reply, HarnessError> {
    let [dir, words @ ..] = args else {
        return Err(HarnessError::invalid_argument(format!("missing course folder; {USAGE}")));
    };
    if words.is_empty() {
        return Err(HarnessError::invalid_argument(format!("missing words to search for; {USAGE}")));
    }
    search(Path::new(dir), &words.join(" "))
}

/// Opens `dir` (relative to the working directory), indexes its lectures and searches them.
fn search(dir: &Path, query: &str) -> Result<Reply, HarnessError> {
    let abs = std::path::absolute(dir).map_err(|_| {
        HarnessError::invalid_argument("the folder path can't be made absolute (no working directory?)")
    })?;
    let core = |e: lecter_core::Error| HarnessError::new(e.code(), e.to_string());
    let listing = course::open(&abs).map_err(core)?;
    let index = CourseIndex::open(Path::new(&listing.path)).map_err(index_error)?;
    for file in &listing.lectures {
        // A lecture the app couldn't open either (too large, not UTF-8) has nothing to search.
        let Ok(opened) = lecture::open(Path::new(&listing.path), &file.path) else { continue };
        index.index_lecture(&opened.path, &opened.text).map_err(index_error)?;
    }
    let mut hits = index.search(query, MAX_HITS).map_err(index_error)?;
    index.drop_missing(Path::new(&listing.path), &mut hits).map_err(index_error)?;
    let json = serde_json::to_value(&hits)
        .map_err(|_| HarnessError::new(ErrorCode::Internal, "the hits could not be written as JSON"))?;
    Ok(Reply { text: text(&hits), json })
}

fn index_error(e: lecter_index::Error) -> HarnessError {
    HarnessError::new(e.code(), e.to_string())
}

/// The hits for a person: one line each, `lecture#block  score  text`.
fn text(hits: &[Hit]) -> String {
    if hits.is_empty() {
        return "no hits".to_owned();
    }
    hits.iter().map(|h| format!("{}#{}  {:.3}  {}", h.lecture, h.block, h.score, h.text)).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(args: &[&str]) -> Result<Reply, HarnessError> {
        run(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn a_folder_and_at_least_one_word_are_required() {
        for args in [&[][..], &["course"][..]] {
            let e = call(args).err().unwrap_or_else(|| panic!("{args:?} was accepted"));
            assert_eq!(e.code, ErrorCode::InvalidArgument, "{args:?}");
            assert!(e.message.contains(USAGE), "{args:?}: {}", e.message);
        }
    }

    #[test]
    fn text_lists_one_hit_per_line_or_says_there_are_none() {
        let hit = |block: &str, score: f32, text: &str| Hit {
            lecture: "lectures/l07.md".into(),
            slide: "s1".into(),
            block: block.into(),
            text: text.into(),
            breadcrumb: "L › S".into(),
            score,
        };
        assert_eq!(text(&[]), "no hits");
        assert_eq!(
            text(&[hit("s1b2", 1.5, "two"), hit("s1b1", 0.25, "one")]),
            "lectures/l07.md#s1b2  1.500  two\nlectures/l07.md#s1b1  0.250  one"
        );
    }
}
