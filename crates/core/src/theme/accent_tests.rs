#![allow(clippy::disallowed_methods, reason = "tests build fake tools on plain test threads")]

use super::*;

fn hex(c: Option<Rgba>) -> Option<String> {
    c.map(|c| c.to_string())
}

/// `reg query` output as Windows prints it.
fn reg_answer(key: &str, name: &str, kind: &str, value: &str) -> String {
    format!("\r\n{key}\r\n    {name}    {kind}    {value}\r\n\r\n")
}

#[test]
fn macos_accent_values_name_the_system_colours() {
    assert_eq!(hex(macos("3\n")), Some("#62ba46".into()));
    assert_eq!(hex(macos("4")), Some("#007aff".into()));
    assert_eq!(hex(macos("-1")), Some("#989898".into()));
    assert_eq!(hex(macos("0")), Some("#e0383e".into()));
    assert_eq!(hex(macos("6")), Some("#f74f9e".into()));
    // Values macOS doesn't define, and text that isn't a number, set nothing.
    assert_eq!(macos("7"), None);
    assert_eq!(macos("-2"), None);
    assert_eq!(macos(""), None);
    assert_eq!(macos("blue"), None);
}

#[test]
fn windows_reads_the_dword_as_abgr() {
    let (key, name) = WINDOWS_VALUES[0];
    // 0xffd77800: alpha ff, blue d7, green 78, red 00 → Windows's default blue #0078d7.
    assert_eq!(hex(windows(&reg_answer(key, name, "REG_DWORD", "0xffd77800"), name)), Some("#0078d7".into()));
    assert_eq!(hex(windows(&reg_answer(key, name, "REG_DWORD", "0x000000ff"), name)), Some("#ff0000".into()));
    assert_eq!(hex(windows(&reg_answer(key, name, "REG_DWORD", "0X0000FF00"), name)), Some("#00ff00".into()));
    // The name is matched without case, as the registry does.
    assert_eq!(
        hex(windows(&reg_answer(key, "accentcolormenu", "REG_DWORD", "0xff112233"), name)),
        Some("#332211".into())
    );
}

#[test]
fn windows_ignores_other_values_kinds_and_bad_numbers() {
    let (key, name) = WINDOWS_VALUES[0];
    assert_eq!(windows(&reg_answer(key, "AccentPalette", "REG_DWORD", "0xffd77800"), name), None);
    assert_eq!(windows(&reg_answer(key, name, "REG_SZ", "0xffd77800"), name), None);
    assert_eq!(windows(&reg_answer(key, name, "REG_DWORD", "ffd77800"), name), None);
    assert_eq!(windows(&reg_answer(key, name, "REG_DWORD", "0xnothex"), name), None);
    assert_eq!(windows(&reg_answer(key, name, "REG_DWORD", "0x1ffd77800"), name), None);
    assert_eq!(windows(&format!("{key}\r\n    {name}    REG_DWORD\r\n"), name), None);
    assert_eq!(windows("", name), None);
}

#[test]
fn only_macos_and_windows_read_their_accent_here() {
    assert_eq!(Os::named("macos"), Some(Os::MacOs));
    assert_eq!(Os::named("windows"), Some(Os::Windows));
    for other in ["linux", "freebsd", "ios", "Windows", ""] {
        assert_eq!(Os::named(other), None, "{other:?}");
    }
    assert_eq!(Os::current(), Os::named(std::env::consts::OS));
    assert_eq!(Os::current().is_some(), cfg!(any(target_os = "macos", windows)));
}

/// Running the tools: fakes are `#!/bin/sh` scripts, which only Unix runs.
#[cfg(unix)]
mod tools {
    use std::path::Path;

    use super::*;
    use crate::testenv::TestEnv;

    fn tool(dir: &Path, name: &str, body: &str) -> OsString {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.into_os_string()
    }

    fn run(os: Os, tools: &AccentTools) -> Option<String> {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        hex(runtime.block_on(read(os, tools)))
    }

    #[test]
    fn macos_asks_defaults_for_the_global_accent() {
        let env = TestEnv::new().unwrap();
        let defaults = tool(env.home(), "defaults", "[ \"$*\" = \"read -g AppleAccentColor\" ] || exit 2\necho 5");
        let tools = AccentTools { defaults, reg: "/nonexistent/reg".into() };
        assert_eq!(run(Os::MacOs, &tools), Some("#953d96".into()));
        // No accent set ("Multicolour"): defaults fails, and Lecter's accent stays.
        let unset = tool(env.home(), "unset", "echo 'does not exist' >&2\nexit 1");
        assert_eq!(run(Os::MacOs, &AccentTools { defaults: unset, ..tools.clone() }), None);
        assert_eq!(run(Os::MacOs, &AccentTools { defaults: "/nonexistent/defaults".into(), ..tools }), None);
    }

    #[test]
    fn windows_reads_the_accent_menu_value_then_dwm() {
        let env = TestEnv::new().unwrap();
        let (menu_key, menu) = WINDOWS_VALUES[0];
        let (dwm_key, dwm) = WINDOWS_VALUES[1];
        let script = |menu_answer: &str| {
            format!(
                "if [ \"$*\" = 'query {menu_key} /v {menu}' ]; then {menu_answer}; fi\n\
                 if [ \"$*\" = 'query {dwm_key} /v {dwm}' ]; then printf '{dwm_key}\\n    {dwm}    REG_DWORD    0xff46ba62\\n'; exit 0; fi\n\
                 exit 1"
            )
        };
        let both = tool(
            env.home(),
            "reg-both",
            &script(&format!("printf '{menu_key}\\n    {menu}    REG_DWORD    0xffd77800\\n'; exit 0")),
        );
        let tools = AccentTools { defaults: "/nonexistent/defaults".into(), reg: both };
        assert_eq!(run(Os::Windows, &tools), Some("#0078d7".into()));
        let dwm_only = tool(env.home(), "reg-dwm", &script("exit 1"));
        assert_eq!(run(Os::Windows, &AccentTools { reg: dwm_only, ..tools.clone() }), Some("#62ba46".into()));
        let none = tool(env.home(), "reg-none", "exit 1");
        assert_eq!(run(Os::Windows, &AccentTools { reg: none, ..tools }), None);
    }
}
