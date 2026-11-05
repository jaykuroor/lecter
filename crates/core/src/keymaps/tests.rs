#![allow(clippy::disallowed_methods, reason = "tests build fixture files on plain test threads")]

use super::*;
use crate::error_code::ErrorCode;
use crate::testenv::TestEnv;

fn file(env: &TestEnv) -> (KeymapsFile, PathBuf) {
    let path = env.dirs().config().join(KEYMAPS_FILE);
    std::fs::create_dir_all(env.dirs().config()).unwrap();
    (KeymapsFile::new(&env.dirs()), path)
}

#[test]
fn reads_the_files_text_from_the_global_config_folder() {
    let env = TestEnv::new().unwrap();
    let (keymaps, path) = file(&env);
    let text = "{ \"version\": 1, // mine\n \"bindings\": [] }";
    std::fs::write(&path, text).unwrap();
    assert_eq!(keymaps.read().unwrap().as_deref(), Some(text));
    assert_eq!(path.file_name().unwrap(), "keymaps.jsonc");
    assert!(path.starts_with(env.dirs().config()));
}

#[test]
fn a_missing_file_is_no_keymap() {
    let env = TestEnv::new().unwrap();
    assert_eq!(KeymapsFile::new(&env.dirs()).read().unwrap(), None);
    assert_eq!(KeymapsFile::at(env.dirs().config().join("nowhere/keymaps.jsonc")).read().unwrap(), None);
}

#[test]
fn reads_a_file_of_exactly_256_kb_and_refuses_one_byte_more() {
    let env = TestEnv::new().unwrap();
    let (keymaps, path) = file(&env);
    let limit = usize::try_from(MAX_KEYMAPS_BYTES).unwrap();
    assert_eq!(limit, 262_144);
    std::fs::write(&path, " ".repeat(limit)).unwrap();
    assert_eq!(keymaps.read().unwrap().map(|t| t.len()), Some(limit));
    std::fs::write(&path, " ".repeat(limit + 1)).unwrap();
    let e = keymaps.read().unwrap_err();
    assert_eq!(e.code(), ErrorCode::InvalidArgument);
    assert_eq!(e.to_string(), "keymaps.jsonc is larger than 256 KB; the default keys are used.");
}

#[test]
fn refuses_text_that_is_not_utf8() {
    let env = TestEnv::new().unwrap();
    let (keymaps, path) = file(&env);
    std::fs::write(&path, [b'{', 0xff, 0xfe, b'}']).unwrap();
    let e = keymaps.read().unwrap_err();
    assert_eq!(e.code(), ErrorCode::InvalidArgument);
    assert_eq!(e.to_string(), "keymaps.jsonc is not UTF-8 text; the default keys are used.");
}

#[cfg(unix)]
#[test]
fn a_file_it_may_not_read_is_an_io_error_not_no_file() {
    use std::os::unix::fs::PermissionsExt;
    let env = TestEnv::new().unwrap();
    let (keymaps, path) = file(&env);
    std::fs::write(&path, "{}").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    let read = keymaps.read();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    // Permission denied is not "no file": the UI shows it and keeps the defaults.
    assert_eq!(read.unwrap_err().code(), ErrorCode::Io);
}

#[test]
fn a_folder_in_its_place_is_an_io_error() {
    let env = TestEnv::new().unwrap();
    let (keymaps, path) = file(&env);
    std::fs::create_dir_all(&path).unwrap();
    let e = keymaps.read().unwrap_err();
    assert_eq!(e.code(), ErrorCode::Io);
    assert_eq!(e.to_string(), "Lecter could not read keymaps.jsonc; the default keys are used.");
}
