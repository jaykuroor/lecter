//! `lecter-harness version`: the workspace version (`{"version":"0.0.1"}`).

use serde_json::json;

use super::{Command, Reply, no_args};
use crate::error::HarnessError;

/// The `version` command.
pub const COMMAND: Command = Command { name: "version", summary: "print the workspace version", run };

fn run(args: &[String]) -> Result<Reply, HarnessError> {
    no_args("version", args)?;
    Ok(Reply { json: json!({ "version": crate::VERSION }), text: format!("{} {}", crate::NAME, crate::VERSION) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_crate_version_inherited_from_the_workspace() {
        let r = run(&[]).unwrap();
        assert_eq!(r.json, json!({ "version": env!("CARGO_PKG_VERSION") }));
        assert_eq!(r.text, format!("lecter-harness {}", env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn rejects_arguments() {
        let e = run(&["x".to_owned()]).unwrap_err();
        assert_eq!(e.code, crate::error::ErrorCode::InvalidArgument);
    }
}
