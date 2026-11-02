//! `lecter-harness course open <dir>`: opens a course folder and prints its `lectures/` and
//! `slides/` listing, the same JSON as the app's `course_open` without its `trust` (F-018).

use std::path::Path;

use lecter_core::course::{self, CourseFile, CourseListing};

use super::{Command, Reply};
use crate::error::HarnessError;

/// The `course` command.
pub const COMMAND: Command =
    Command { name: "course", summary: "course open <dir>: list a course folder's lectures and slides", run };

const USAGE: &str = "usage: course open <dir>";

fn run(args: &[String]) -> Result<Reply, HarnessError> {
    match args {
        [verb, dir] if verb == "open" => open(Path::new(dir)),
        [verb, ..] if verb == "open" => {
            Err(HarnessError::invalid_argument(format!("course open takes one folder; {USAGE}")))
        }
        [verb, ..] => Err(HarnessError::invalid_argument(format!("unknown course command \"{verb}\"; {USAGE}"))),
        [] => Err(HarnessError::invalid_argument(format!("missing course command; {USAGE}"))),
    }
}

/// Opens `dir` (relative to the working directory, like any command-line path) through the core.
fn open(dir: &Path) -> Result<Reply, HarnessError> {
    let abs = std::path::absolute(dir).map_err(|_| {
        HarnessError::invalid_argument("the folder path can't be made absolute (no working directory?)")
    })?;
    let listing = course::open(&abs).map_err(|e| HarnessError::new(e.code(), e.to_string()))?;
    let json = serde_json::to_value(&listing)
        .map_err(|_| HarnessError::new(lecter_core::ErrorCode::Internal, "the listing could not be written as JSON"))?;
    Ok(Reply { text: text(&listing), json })
}

/// The listing for a person: the folder, then each subfolder's files.
fn text(listing: &CourseListing) -> String {
    let mut out = format!("{} ({})", listing.name, listing.path);
    for (label, files) in [("lectures", &listing.lectures), ("slides", &listing.slides)] {
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
        for args in [&[][..], &["list"][..], &["open"][..], &["open", "a", "b"][..]] {
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
            lectures: vec![CourseFile { name: "l01.md".into(), path: "lectures/l01.md".into() }],
            slides: vec![],
        };
        assert_eq!(text(&listing), "STAT311 (/c/STAT311)\nlectures: 1\n  lectures/l01.md\nslides: 0");
    }
}
