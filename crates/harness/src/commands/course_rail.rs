//! The course rail through the core (F-035, D-188): `course list` prints the courses on the rail
//! as the app's `course_list` returns them; `course add <dir>` puts a folder on it, as opening it
//! in the app does; `course reorder <path>…` saves a new order, as dragging does. JSON: the list,
//! `[{"path", "name", "icon", "color", "missing"}, …]`.

use std::path::Path;

use lecter_core::course::known::{KnownCourse, KnownCourses};
use lecter_core::course::{self};
use lecter_core::paths::AppDirs;

use super::Reply;
use super::course::{USAGE, absolute};
use super::gate::core_error;
use crate::error::HarnessError;

/// Runs `course list`, `course add` or `course reorder` (`verb`) with the arguments after it.
pub(super) fn run(verb: &str, args: &[String]) -> Result<Reply, HarnessError> {
    let valid = matches!((verb, args.len()), ("list", 0) | ("add", 1) | ("reorder", 1..));
    if !valid {
        return Err(HarnessError::invalid_argument(format!("course {verb} takes other arguments; {USAGE}")));
    }
    let known = KnownCourses::new(&AppDirs::resolve().map_err(core_error)?);
    match (verb, args) {
        ("add", [dir]) => {
            let listing = course::open(&absolute(Path::new(dir))?).map_err(core_error)?;
            known.add(&listing.path).map_err(core_error)?;
        }
        ("reorder", order) => {
            known.reorder(order).map_err(core_error)?;
        }
        _ => {}
    }
    reply(&known.list().map_err(core_error)?)
}

fn reply(list: &[KnownCourse]) -> Result<Reply, HarnessError> {
    let json = serde_json::to_value(list)
        .map_err(|_| HarnessError::new(lecter_core::ErrorCode::Internal, "the list could not be written as JSON"))?;
    Ok(Reply { text: text(list), json })
}

/// The rail for a person: one line per course, in order.
fn text(list: &[KnownCourse]) -> String {
    if list.is_empty() {
        return "no courses on the rail".to_owned();
    }
    let line = |(i, c): (usize, &KnownCourse)| {
        let missing = if c.missing { " (missing)" } else { "" };
        format!("{}. [{}] {} {}{missing} ({})", i + 1, c.icon, c.name, c.color, c.path)
    };
    list.iter().enumerate().map(line).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn course(path: &str, name: &str, missing: bool) -> KnownCourse {
        KnownCourse { path: path.into(), name: name.into(), icon: "S".into(), color: "#3584e4".into(), missing }
    }

    #[test]
    fn text_lists_the_rail_in_order_and_marks_missing_courses() {
        let list = [course("/c/stat", "Statistics", false), course("/c/bio", "Biology", true)];
        assert_eq!(text(&list), "1. [S] Statistics #3584e4 (/c/stat)\n2. [S] Biology #3584e4 (missing) (/c/bio)");
        assert_eq!(text(&[]), "no courses on the rail");
    }
}
