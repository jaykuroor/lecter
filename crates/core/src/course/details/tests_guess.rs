//! F-034: the name, code, term and icon guessed from a course folder's name.

use super::guess::{Parsed, parse};

fn parsed(name: &str, code: &str, term: &str) -> Parsed {
    Parsed { name: name.into(), code: code.into(), term: term.into() }
}

#[test]
fn a_folder_name_gives_the_name_code_and_term() {
    let cases = [
        (
            "STAT311 - Probability and Statistics (Fall 2026)",
            parsed("Probability and Statistics", "STAT 311", "Fall 2026"),
        ),
        ("STAT 311 Probability", parsed("Probability", "STAT 311", "")),
        ("CS-101A_Intro_to_Programming_spring2025", parsed("Intro to Programming", "CS 101A", "Spring 2025")),
        ("Probability_and_Statistics_Fall_2026", parsed("Probability and Statistics", "", "Fall 2026")),
        ("Linear Algebra", parsed("Linear Algebra", "", "")),
        ("Sample Course", parsed("Sample Course", "", "")),
        ("MATH2410 [Winter 2027]", parsed("MATH2410 [Winter 2027]", "MATH 2410", "Winter 2027")),
        ("STAT311", parsed("STAT311", "STAT 311", "")),
        ("Économie politique", parsed("Économie politique", "", "")),
    ];
    for (folder, want) in cases {
        assert_eq!(parse(folder), want, "{folder}");
    }
}

/// Lower-case letters, too many or too few letters or digits, and years outside 19xx/20xx aren't
/// codes or terms.
#[test]
fn near_misses_stay_in_the_name() {
    let cases = [
        ("Stat 311", parsed("Stat 311", "", "")),
        ("S 311", parsed("S 311", "", "")),
        ("STATISTICS 311", parsed("STATISTICS 311", "", "")),
        ("STAT 31111", parsed("STAT 31111", "", "")),
        ("STAT 3", parsed("STAT 3", "", "")),
        ("STAT  311", parsed("STAT 311", "", "")),
        ("Fall 1850", parsed("Fall 1850", "", "")),
        ("Fall 26", parsed("Fall 26", "", "")),
        ("Fallout 2026", parsed("Fallout 2026", "", "")),
        ("STAT 311AB", parsed("STAT 311AB", "", "")),
    ];
    for (folder, want) in cases {
        assert_eq!(parse(folder), want, "{folder}");
    }
}
