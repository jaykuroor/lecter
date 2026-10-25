//! The harness commands. A feature adds its command here: one file in this folder and one
//! [`Command`] line in [`COMMANDS`].

mod version;

use serde_json::Value;

use crate::error::HarnessError;

/// What a successful command prints: `json` with `--json`, `text` without.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    /// The one JSON result.
    pub json: Value,
    /// The same result for a person, one or more lines without the final newline.
    pub text: String,
}

/// One subcommand.
pub struct Command {
    /// The name typed after `lecter-harness`.
    pub name: &'static str,
    /// One line for the list of commands.
    pub summary: &'static str,
    /// Runs it with the arguments after its name (`--json` already removed).
    pub run: fn(&[String]) -> Result<Reply, HarnessError>,
}

/// Every command, in the order a list shows them.
pub const COMMANDS: &[Command] = &[version::COMMAND];

/// The command called `name`.
pub fn find(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|c| c.name == name)
}

/// The command names, comma-separated, for error messages.
pub fn names() -> String {
    COMMANDS.iter().map(|c| c.name).collect::<Vec<_>>().join(", ")
}

/// Fails with `E_INVALID_ARGUMENT` when a command that takes no arguments got some.
pub fn no_args(command: &str, args: &[String]) -> Result<(), HarnessError> {
    match args.first() {
        None => Ok(()),
        Some(a) => Err(HarnessError::invalid_argument(format!("{command} takes no arguments, got \"{a}\""))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_names_are_unique_lowercase_words() {
        let mut seen = std::collections::HashSet::new();
        for c in COMMANDS {
            assert!(seen.insert(c.name), "duplicate command {}", c.name);
            assert!(!c.name.is_empty() && c.name.chars().all(|ch| ch.is_ascii_lowercase() || ch == '-'), "{}", c.name);
            assert!(!c.summary.is_empty(), "{} has no summary", c.name);
        }
    }

    #[test]
    fn find_returns_the_named_command_only() {
        assert_eq!(find("version").map(|c| c.name), Some("version"));
        assert!(find("Version").is_none() && find("").is_none());
    }
}
