//! `lecter-harness course open <dir>`: opens a course folder and prints its `lectures/` and
//! `slides/` listing, the same JSON as the app's `course_open` without its `trust` and `screen`
//! (F-018). `course trust <dir> [trusted|read-only]`: its trust screen, or the answer (F-033,
//! `course_trust.rs`). `course list | add <dir> | reorder <path>…`: the course rail (F-035,
//! `course_rail.rs`).

use std::path::{Path, PathBuf};

use lecter_core::course::{self, CourseFile, CourseListing, LectureFile};

use super::{Command, Reply, course_rail, course_trust};
use crate::error::HarnessError;

/// The `course` command.
pub const COMMAND: Command = Command {
    name: "course",
    summary: "course open <dir> | course trust <dir> [trusted|read-only] | course list | course add <dir> | course reorder <path>...: list a course folder, show or answer its trust screen, or show and change the course rail",
    run,
};

pub(super) const USAGE: &str = "usage: course open <dir> | course trust <dir> [trusted|read-only] | course list | course add <dir> | course reorder <path>...";

fn run(args: &[String]) -> Result<Reply, HarnessError> {
    match args {
        [verb, dir] if verb == "open" => open(Path::new(dir)),
        [verb, ..] if verb == "open" => {
            Err(HarnessError::invalid_argument(format!("course open takes one folder; {USAGE}")))
        }
        [verb, rest @ ..] if verb == "trust" => course_trust::run(rest),
        [verb, rest @ ..] if ["list", "add", "reorder"].contains(&verb.as_str()) => course_rail::run(verb, rest),
        [verb, ..] => Err(HarnessError::invalid_argument(format!("unknown course command \"{verb}\"; {USAGE}"))),
        [] => Err(HarnessError::invalid_argument(format!("missing course command; {USAGE}"))),
    }
}

/// Opens `dir` (relative to the working directory, like any command-line path) through the core.
fn open(dir: &Path) -> Result<Reply, HarnessError> {
    let listing = course::open(&absolute(dir)?).map_err(|e| HarnessError::new(e.code(), e.to_string()))?;
    let json = serde_json::to_value(&listing)
        .map_err(|_| HarnessError::new(lecter_core::ErrorCode::Internal, "the listing could not be written as JSON"))?;
    Ok(Reply { text: text(&listing), json })
}

/// A command-line folder path, made absolute against the working directory.
pub(super) fn absolute(dir: &Path) -> Result<PathBuf, HarnessError> {
    std::path::absolute(dir)
        .map_err(|_| HarnessError::invalid_argument("the folder path can't be made absolute (no working directory?)"))
}

/// The listing for a person: the folder, then each subfolder's files, a lecture with its date.
fn text(listing: &CourseListing) -> String {
    let mut out = format!("{} ({})", listing.name, listing.path);
    out.push_str(&format!("\nlectures: {}", listing.lectures.len()));
    for LectureFile { path, date, .. } in &listing.lectures {
        match date {
            Some(date) => out.push_str(&format!("\n  {path} ({date})")),
            None => out.push_str(&format!("\n  {path}")),
        }
    }
    for (label, files) in [("slides", &listing.slides), ("sources", &listing.sources)] {
        out.push_str(&format!("\n{label}: {}", files.len()));
        for CourseFile { path, .. } in files {
            out.push_str(&format!("\n  {path}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn call(args: &[&str]) -> Result<Reply, HarnessError> {
        run(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn only_open_with_exactly_one_folder_is_a_valid_call() {
        for args in [
            &[][..],
            &["lists"][..],
            &["open"][..],
            &["open", "a", "b"][..],
            &["list", "x"][..],
            &["add"][..],
            &["reorder"][..],
        ] {
            let e = call(args).err().unwrap_or_else(|| panic!("{args:?} was accepted"));
            assert_eq!(e.code, ErrorCode::InvalidArgument, "{args:?}");
            assert!(e.message.contains(USAGE), "{args:?}: {}", e.message);
        }
    }

    #[test]
    fn text_lists_the_folder_then_each_subfolder() {
        let listing = CourseListing {
            path: "/c/STAT311".into(),
            name: "STAT311".into(),
            lectures: vec![
                LectureFile { name: "l01.md".into(), path: "lectures/l01.md".into(), date: None },
                LectureFile { name: "l02.md".into(), path: "lectures/l02.md".into(), date: Some("2026-10-23".into()) },
            ],
            slides: vec![],
            sources: vec![CourseFile { name: "book.pdf".into(), path: "sources/book.pdf".into() }],
            capped: vec![],
        };
        assert_eq!(
            text(&listing),
            "STAT311 (/c/STAT311)\nlectures: 2\n  lectures/l01.md\n  lectures/l02.md (2026-10-23)\nslides: 0\nsources: 1\n  sources/book.pdf"
        );
    }
}
