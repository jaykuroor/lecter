// The commands the shell registers, by name. `build.rs` includes this file to generate one
// `allow-<command>` permission per name; the capability tests check `capabilities/` against it.

/// Every Tauri command the shell exposes, in snake_case (`18-contracts.md#ipc`).
pub const COMMANDS: &[&str] = &["app_info", "course_open", "lecture_open"];
