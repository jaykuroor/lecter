"""Tests for the test-smell part of scripts/check_tests.py: new tests must assert something real."""
import shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import check_tests  # noqa: E402

BASE_RS = "pub fn add(a: i32, b: i32) -> i32 { a + b }\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn old_weak() { assert!(true); }\n}\n"
BASE_TS = "import { expect, test } from 'vitest';\ntest('old', () => { expect(1).toBe(1); });\n"


def sh(cwd, *args):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(f"{args} failed: {r.stderr}")
    return r.stdout


class Smells(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="lecter-smells-"))
        for a in (("init", "-q", "-b", "main"), ("config", "user.email", "t@example.com"), ("config", "user.name", "t"),
                  ("config", "commit.gpgsign", "false")):
            sh(self.root, "git", *a)
        self.write("crates/core/src/lib.rs", BASE_RS)
        self.write("ui/src/clamp.test.ts", BASE_TS)
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-q", "-m", "base")
        self.base = sh(self.root, "git", "rev-parse", "HEAD").strip()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def rs(self, *tests):
        self.write("crates/core/src/lib.rs", BASE_RS.replace("    fn old_weak() { assert!(true); }\n",
                                                             "    fn old_weak() { assert!(true); }\n" + "".join(tests)))

    def ts(self, *tests):
        self.write("ui/src/clamp.test.ts", BASE_TS + "".join(tests))

    def found(self, msg=None):
        if msg:
            sh(self.root, "git", "add", "-A")
            sh(self.root, "git", "commit", "-q", "-m", msg)
        problems, _ = check_tests.smells(self.root, self.base)
        return [p.split(": new test ")[0].split("::")[-1] for p in problems]  # the test names

    # Rust
    def test_rust_test_without_assertion_fails(self):
        self.rs("    #[test]\n    fn parses() -> Result<(), String> { let _x = super::add(1, 2); Ok(()) }\n")
        self.assertEqual(self.found(), ["parses"])

    def test_rust_constant_and_self_comparison_fail(self):
        self.rs("    #[test]\n    fn a() { assert!(true, \"ok\"); }\n",
                "    #[test]\n    fn b() { let x = super::add(1, 2); assert_eq!(x, x); }\n")
        self.assertEqual(sorted(self.found()), ["a", "b"])

    def test_rust_only_is_ok_fails_but_value_check_passes(self):
        self.rs("    #[test]\n    fn weak() { let r: Result<i32, ()> = Ok(super::add(1, 2)); assert!(r.is_ok()); }\n",
                "    #[test]\n    fn strong() { let r: Result<i32, ()> = Ok(super::add(1, 2)); assert!(r.is_ok()); assert_eq!(r, Ok(3)); }\n")
        self.assertEqual(self.found(), ["weak"])

    def test_rust_real_assertions_pass(self):
        self.rs("    #[test]\n    fn adds() { assert_eq!(super::add(1, 2), 3); }\n",
                "    #[test]\n    #[should_panic(expected = \"overflow\")]\n    fn overflows() { super::add(i32::MAX, 1); }\n",
                "    fn check_sum(a: i32, b: i32, want: i32) { assert_eq!(super::add(a, b), want); }\n",
                "    #[test]\n    fn via_helper() { check_sum(2, 2, 4); }\n",
                "    #[tokio::test]\n    async fn snap() { insta::assert_snapshot!(format!(\"{}\", super::add(1, 1))); }\n")
        self.assertEqual(self.found(), [])

    def test_existing_tests_are_not_judged(self):
        self.rs("    #[test]\n    fn adds() { assert_eq!(super::add(1, 2), 3); }\n")
        self.assertEqual(self.found(), [])  # old_weak was already there

    def test_brace_in_string_does_not_break_parsing(self):
        self.rs("    #[test]\n    fn braces() { let s = \"}{\"; assert_eq!(s.len(), 2); }\n",
                "    #[test]\n    fn empty() { let _s = \"{\"; }\n")
        self.assertEqual(self.found(), ["empty"])

    # TypeScript
    def test_ts_weak_literal_and_empty_fail(self):
        self.ts("test('exists', () => { const x = clamp(3); expect(x).toBeDefined(); expect(x).not.toBeNull(); });\n",
                "test('literal', () => { expect(true).toBe(true); });\n",
                "it('nothing', async () => { await render(); });\n",
                "test('self', () => { const x = clamp(3); expect(x).toEqual(x); });\n")
        self.assertEqual(sorted(self.found()), ["exists", "literal", "nothing", "self"])

    def test_ts_real_assertions_pass(self):
        self.ts("test('clamps', () => { expect(clamp(30)).toBe(10); });\n",
                "test('throws', () => { expect(() => clamp(-1)).toThrow('negative'); });\n",
                "test.each([[1, 1], [30, 10]])('clamps %i', (n, want) => { expect(clamp(n)).toBe(want); });\n",
                "test('truthy plus value', () => { expect(clamp(3)).toBeTruthy(); expect(clamp(3)).toBe(3); });\n",
                "const expectClamped = (n: number) => { expect(clamp(n)).toBeLessThanOrEqual(10); };\n",
                "test('helper', () => { expectClamped(50); });\n")
        self.assertEqual(self.found(), [])

    def test_trailer_excuses_a_named_test(self):
        self.ts("test('exists', () => { expect(clamp(3)).toBeDefined(); });\n")
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-q", "-m",
           "F-099: smoke\n\nTest-Smell-Ok: ui/src/clamp.test.ts::exists - the export only has to exist (spec 18)")
        self.assertEqual(self.found(), [])

    def test_many_mocks_warn_without_failing(self):
        self.ts("vi.mock('a'); vi.mock('b'); const f = vi.fn(); const g = vi.spyOn(o, 'x');\n",
                "test('clamps', () => { expect(clamp(30)).toBe(10); });\n")
        problems, warnings = check_tests.smells(self.root, self.base)
        self.assertEqual(problems, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn("4 mocks", warnings[0])

    def test_main_fails_on_a_smell(self):
        self.ts("test('exists', () => { expect(clamp(3)).toBeDefined(); });\n")
        self.assertEqual(check_tests.main(["--base", self.base, "--root", str(self.root)]), 1)


if __name__ == "__main__":
    unittest.main()
