//! `lecter-harness course trust <dir> [trusted|read-only]` (F-033): without an answer, prints the
//! course's trust state and its trust screen, as the app's `course_open` returns them; with one,
//! stores it for the screen as it is now (as pressing Trust or Open read-only does) and prints the
//! state and screen after it. JSON: `{"trust": "ask"|"trusted"|"read_only", "screen": {…}}`.

use std::path::Path;

use lecter_ai::provider::scripted::SAMPLE_ID;
use lecter_core::course;
use lecter_core::course::trust::{self, TrustChoice, TrustScreen, TrustState};
use serde_json::json;

use super::Reply;
use super::course::{USAGE, absolute};
use super::gate::{core_error, store};
use crate::error::HarnessError;

/// Runs `course trust` with the arguments after `trust`.
pub(super) fn run(args: &[String]) -> Result<Reply, HarnessError> {
    let (dir, choice) = match args {
        [dir] => (dir, None),
        [dir, word] => (dir, Some(choice(word)?)),
        _ => return Err(HarnessError::invalid_argument(format!("course trust takes a folder and an answer; {USAGE}"))),
    };
    trust_folder(&absolute(Path::new(dir))?, choice)
}

/// The answer a word names.
fn choice(word: &str) -> Result<TrustChoice, HarnessError> {
    match word {
        "trusted" => Ok(TrustChoice::Trusted),
        "read-only" => Ok(TrustChoice::ReadOnly),
        _ => Err(HarnessError::invalid_argument(format!("unknown answer \"{word}\"; {USAGE}"))),
    }
}

fn trust_folder(dir: &Path, choice: Option<TrustChoice>) -> Result<Reply, HarnessError> {
    let store = store()?;
    let listing = course::open(dir).map_err(core_error)?;
    let mut review = trust::review(&store, &listing, SAMPLE_ID).map_err(core_error)?;
    if let Some(choice) = choice {
        trust::decide(&store, &listing.path, choice, &review.fingerprint).map_err(core_error)?;
        review = trust::review(&store, &listing, SAMPLE_ID).map_err(core_error)?;
    }
    let json = json!({ "trust": review.state, "screen": review.screen });
    Ok(Reply { text: text(review.state, &review.screen), json })
}

/// The state and the screen for a person.
fn text(state: TrustState, s: &TrustScreen) -> String {
    let state = match state {
        TrustState::Ask => "ask",
        TrustState::Trusted => "trusted",
        TrustState::ReadOnly => "read-only",
    };
    let mut out = format!(
        "trust: {state}{}\n{} lectures, {} slides, {} sources\nprovider: {}\nweb search: {}",
        if s.changed { " (its AI files changed)" } else { "" },
        s.lectures,
        s.slides,
        s.sources,
        s.provider,
        if s.web_search { "on" } else { "off" },
    );
    for (label, list) in
        [("AGENTS.md", &s.agents), ("roles", &s.roles), ("skills", &s.skills), ("overrides", &s.overrides)]
    {
        out.push_str(&format!("\n{label}: {}", if list.is_empty() { "none".to_owned() } else { list.join(", ") }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn answers_are_trusted_or_read_only_only() {
        assert_eq!(choice("trusted"), Ok(TrustChoice::Trusted));
        assert_eq!(choice("read-only"), Ok(TrustChoice::ReadOnly));
        for word in ["trust", "read_only", "Trusted", "", "yes"] {
            let e = choice(word).err().unwrap_or_else(|| panic!("{word:?} was accepted"));
            assert_eq!(e.code, ErrorCode::InvalidArgument, "{word:?}");
        }
    }

    #[test]
    fn a_folder_is_required_and_at_most_one_answer() {
        for args in [&[][..], &["c", "trusted", "x"][..]] {
            let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
            let e = run(&args).err().unwrap_or_else(|| panic!("{args:?} was accepted"));
            assert_eq!(e.code, ErrorCode::InvalidArgument, "{args:?}");
            assert!(e.message.contains(USAGE), "{args:?}: {}", e.message);
        }
    }

    #[test]
    fn text_shows_the_state_counts_and_lists() {
        let screen = TrustScreen {
            lectures: 6,
            slides: 12,
            sources: 3,
            provider: "sample".into(),
            web_search: false,
            agents: vec!["AGENTS.md".into()],
            roles: vec![".lecter/agents/tutor.md".into(), ".lecter/agents/quiz.md".into()],
            skills: vec![],
            overrides: vec!["ui.performance".into()],
            changed: true,
        };
        assert_eq!(
            text(TrustState::Ask, &screen),
            "trust: ask (its AI files changed)\n6 lectures, 12 slides, 3 sources\nprovider: sample\nweb search: off\n\
             AGENTS.md: AGENTS.md\nroles: .lecter/agents/tutor.md, .lecter/agents/quiz.md\nskills: none\n\
             overrides: ui.performance"
        );
        assert!(
            text(TrustState::ReadOnly, &TrustScreen { changed: false, ..screen }).starts_with("trust: read-only\n")
        );
    }
}
