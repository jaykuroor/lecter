// The commands the shell registers, by name. `build.rs` includes this file to generate one
// `allow-<command>` permission per name; the capability tests check `capabilities/` against it.

/// Every Tauri command the shell exposes, in snake_case (`18-contracts.md#ipc`).
pub const COMMANDS: &[&str] = &[
    "gloss_request",
    "gloss_cancel",
    "app_info",
    "app_mark_startup",
    "app_layout_get",
    "app_layout_save",
    "course_open",
    "course_list",
    "course_switch",
    "course_reorder",
    "course_trust",
    "course_details_save",
    "lecture_open",
    "lecture_apply_edits",
    "search_find",
];
