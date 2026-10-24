# Spike: parse-worker OS sandboxes (F-005)

## Question

Can the parse worker (SEC-01, `docs/spec/13-security.md#untrusted-files`) be sandboxed on Linux, macOS
and Windows so that, once sandboxed, it has **no network**, can **read only its one input file**, and
**cannot exceed 1 GiB** of memory, using only `libc` and `windows-sys` (both already in the lockfile)?

## Method

`lecter-spike-os-sandbox` is a workspace crate with one child binary, `sandbox-probe`, and six tests
(`tests/sandbox.rs`). Each test runs a probe twice: once unsandboxed (the control, which must succeed)
and once sandboxed (which must be refused with exit code 10; exit 20 means the sandbox couldn't be
applied, so the test fails rather than passing by accident).

| Probe | Control expects | Sandboxed expects |
|---|---|---|
| `read <input>` | — | read OK |
| `read <sibling file>` | read OK | refused |
| `read <file in another folder>` (the crate's `Cargo.toml`) | read OK | refused |
| `net <loopback listener>` | connected | refused |
| `alloc 1088` MiB (1 GiB + 64 MiB, one byte written per page) | holds it | allocation refused |
| `alloc 256` MiB | — | holds it |

| OS | How (code) | Network | Files | Memory |
|---|---|---|---|---|
| Linux | child applies to itself (`src/linux/`) | seccomp: `socket`, `socketpair`, `connect`, `bind`, `listen`, `accept*` → `EPERM`; Landlock ≥ ABI 4 also handles TCP bind/connect | Landlock: every fs right handled, one `READ_FILE` rule on the input | `RLIMIT_AS` = 1 GiB |
| macOS | child applies to itself (`src/macos.rs`) | Seatbelt `(deny default)` | Seatbelt `(allow file-read* (literal <input>))` | `RLIMIT_AS` = map size at entry + 1 GiB (the dyld shared region already exceeds 1 GiB) |
| Windows | parent launches (`src/windows.rs`) | AppContainer with no capabilities (no loopback either) | ACL grant to the container SID on the exe and the input only | Job object: `ProcessMemoryLimit` 1 GiB, 1 active process, kill on close |

Other hardening in the filter: a foreign syscall ABI (i386 on x86_64, x32) kills the process;
io_uring, `ptrace` and `process_vm_*` return `EPERM`.

## Rerun

```sh
spikes/os-sandbox/run.sh                         # this OS
cargo nextest run -p lecter-spike-os-sandbox     # the same tests, plain
```

macOS and Windows run in the `test` job of `.github/workflows/ci.yml` (it runs the whole workspace on
ubuntu-24.04, macos-15 and windows-2025).

## Results

**Linux** (Fedora 44, kernel 7.2.11, x86_64; inside Claude Code's bubblewrap sandbox, which already
sets `no_new_privs` and its own seccomp filter, so ours stacks on top): 6/6 pass. Landlock ABI 10.
Sandboxed `read` of a sibling or another folder → `EACCES`; `net` → `EPERM` at `socket()`;
`alloc 1088` → refused after 1008 MiB; `alloc 256` → held. With the sandbox switched off, the four
denial tests fail (the probe reads, connects and holds 1088 MiB).

**macOS, Windows:** not yet measured (CI). Compile- and clippy-clean for `aarch64-apple-darwin` and
`x86_64-pc-windows-msvc`.

## Known gaps (for the parse worker, not this spike)

- Windows: files whose ACL grants ALL APPLICATION PACKAGES (most of `C:\Windows`) stay readable.
- macOS: `sandbox_init` is deprecated (still shipped and used by Chromium); `RLIMIT_AS` enforcement
  on XNU is what the `test` job measures.
- The 60 s time limit (SEC-01) is the parent's job (wall clock kill); not part of this spike.
- The seccomp filter is a deny list; the worker should switch to an allow list once its syscalls are known.
