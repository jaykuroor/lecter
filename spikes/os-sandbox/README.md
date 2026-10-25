# Spike: parse-worker OS sandboxes (F-005)

## Question

Can the parse worker (SEC-01, `docs/spec/13-security.md#untrusted-files`) be sandboxed on Linux, macOS
and Windows so that, once sandboxed, it has **no network**, can **read only its one input file**, and
**cannot exceed 1 GiB** of memory, using only `libc` and `windows-sys` (both already in the lockfile)?

## Method

`lecter-spike-os-sandbox` is a workspace crate with one child binary, `sandbox-probe`, and the tests
in `tests/sandbox.rs`. A denial test runs its probe twice. The unsandboxed control run must succeed.
The sandboxed run must be refused with exit code 10. Exit 20 means the sandbox couldn't be applied,
so the test fails instead of passing by accident.

| Test | Probe | Control | Sandboxed |
|---|---|---|---|
| can read its input | `read-input` | — | read OK |
| cannot read a sibling file | `read <secret next to input>` | read OK | refused |
| cannot read a file in another folder | `read <crate Cargo.toml>` | read OK | refused |
| cannot read an earlier run's input | run 1 reads A; run 2 (input B) reads A | read OK | refused |
| cannot read a system file (Windows) | `read %SystemRoot%\win.ini` | read OK | refused |
| cannot open a network socket | `net <loopback listener>` | connected | refused |
| cannot use an inherited socket (Unix) | `use-fd <connected TCP fd, CLOEXEC cleared>` | write OK | refused |
| cannot exceed 1 GiB | `alloc 1088` MiB (one byte written per page) | holds it | refused |
| cannot start a process to exceed 1 GiB | `spawn-alloc 768`: two processes × 768 MiB | both hold it | refused |
| can allocate under the limit | `alloc 256` | — | holds it |
| can start a thread | `thread` | — | runs |
| enter refuses when a thread started first (Linux) | `--thread-first --sandbox …` | — | exit 20 |

| OS | Applied by | Network | Files | Memory and processes |
|---|---|---|---|---|
| Linux (`src/linux/`) | the child, first thing | seccomp: `socket`, `socketpair`, `connect`, `bind`, `listen`, `accept*` → `EPERM`. Landlock handles TCP bind/connect (ABI ≥ 4) and UDP (ABI ≥ 10) too | Landlock handles every fs right defined up to ABI 10 that the kernel supports (incl. RESOLVE_UNIX at ABI 9). The one rule is `READ_FILE` on the input. `close_range(3, ~0)` closes inherited fds first | `RLIMIT_AS` = 1 GiB. seccomp: `clone` only with `CLONE_THREAD`, `clone3` → `ENOSYS` (libc falls back to `clone`), `fork`/`vfork` → `EPERM`. `PR_SET_PDEATHSIG` = `SIGKILL` |
| macOS (`src/macos.rs`) | the child, first thing | Seatbelt `(deny default)` | `enter` opens the input before `sandbox_init`, and the worker reads through that fd. The profile also allows `file-read*` on the input literal. Every fd above 2 (from `/dev/fd`) is closed first | `RLIMIT_AS` = map size at entry + 1 GiB, because the dyld shared region already exceeds 1 GiB. `(deny default)` also denies `process-fork` and `process-exec` |
| Windows (`src/windows.rs`) | the parent, at creation | AppContainer with no capabilities (no loopback either) | Less Privileged AppContainer (ALL APPLICATION PACKAGES grants don't apply; ALL RESTRICTED APPLICATION PACKAGES grants still do). The only ACE is read/execute on the probe exe. The input is opened by the parent and inherited as one handle via `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`; the file's ACL is never touched. A stderr pipe is the only other inherited handle | Job object: `ProcessMemoryLimit` 1 GiB, 1 active process, kill on job close |

Other seccomp hardening: a foreign syscall ABI (i386 on x86_64, x32) kills the process, and io_uring,
`ptrace` and `process_vm_*` return `EPERM`.

## Rerun

```sh
spikes/os-sandbox/run.sh                         # this OS; prints every probe's result
cargo nextest run -p lecter-spike-os-sandbox     # the same tests, plain
```

macOS and Windows run in the `test` job of `.github/workflows/ci.yml`, which runs the whole workspace
on ubuntu-24.04, macos-15 and windows-2025.

## Results

| OS | Go / no-go | Evidence |
|---|---|---|
| Linux | **GO** | 11/11 pass locally (below) |
| macOS | **GO** | macos-15: every spike test passed in CI run 40119881557 (8f4b4a7) and in run 40154388308 (c8900b7, the shipped code), including `RLIMIT_AS` at +1 GiB |
| Windows | **IMPOSSIBLE as specified** for "no file other than its input"; GO for network, user files, earlier inputs, memory and processes | windows-2025, runs 40120703752 and 40154388308 (LPAC): 55/56. Network, earlier input, sibling and other-folder files, 1 GiB, spawn and thread pass. LPAC still reads `%SystemRoot%\win.ini` (92 bytes); the test prints its SDDL. Run 40153640323 (30934ba, LPAC + Chromium-style lockdown token): the child can't start (0xC0000135 STATUS_DLL_NOT_FOUND) |

**Linux:** Fedora 44, kernel 7.2.11, x86_64, Landlock ABI 10. Measured inside Claude Code's bubblewrap
sandbox, which already sets `no_new_privs` and its own seccomp filter; ours stacks on top. Sandboxed
results:
- reads of a sibling file, another folder or the earlier run's input → `EACCES`;
- `net` → `EPERM` at `socket()`;
- `alloc 1088` → refused after 1008 MiB;
- `spawn-alloc` → `fork` gets `EPERM`;
- the inherited socket → `EBADF`;
- `--thread-first` → `enter` refuses.

Two runs with key lines switched off show the tests catch a missing defence. With the whole sandbox
off, the first four denial tests fail. With `close_range`, the thread check and the clone/fork rules
off, their three tests fail (`.evidence/F-005/`, not tracked).

CI run 40119212625 (e4b5dcf) found two spike bugs; nextest's fail-fast then skipped the rest:
- **macOS:** `read-input` opened the input by its `/var/folders/…` path inside the sandbox and got
  `EPERM`, although the profile allowed the canonical `/private/var/…` literal. The likely cause is
  that the lookup through the `/var` symlink is itself denied. Fix: `enter` now opens the input
  before the profile applies (Linux does the same), so the worker never resolves a path inside the
  sandbox. The denial tests still read other files by path.
- **Windows:** the sandboxed probe exited 101 (a panic) with no stderr. The likely cause is that
  `eprintln!` panicked on the LPAC child's unusable console handle. Fix: the probe's logging ignores
  write errors, a panic hook reports the panic and exits 101, and the child gets a stderr pipe
  through the handle list.

**Windows network:** in an LPAC child, the network is denied as early as Winsock initialisation:
`WSAStartup` returns 10107 (WSASYSCALLFAILURE). std's lazy Winsock init asserts on success, so any
`std::net` call in such a child panics. The parse worker must not use `std::net`, and anything that
might touch Winsock must call `WSAStartup` itself and treat failure as "no network".

**Windows system files:** LPAC still honours ALL RESTRICTED APPLICATION PACKAGES grants, which
`C:\Windows` carries so that sandboxed processes can load system DLLs. One stricter attempt was made
at 30934ba: a lockdown restricted token (restricting SID NULL) under LPAC, with the main thread
impersonating a startup token while the loader ran. In run 40153640323 the child failed to start
with 0xC0000135 (STATUS_DLL_NOT_FOUND). Per Jay's decision there was no second attempt, and the
active code is LPAC only. User files (the sibling, the other folder, an earlier run's input) are
denied.

The final LPAC run, 40154388308 (c8900b7), passed 55/56. The test printed this SDDL for
`C:\Windows\win.ini`:

```
O:SYG:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;0x1200a9;;;BU)(A;ID;0x1200a9;;;AC)(A;ID;0x1200a9;;;S-1-15-2-2)S:AINO_ACCESS_CONTROL
```

The read is allowed by the inherited ACE `(A;ID;0x1200a9;;;S-1-15-2-2)`: ALL RESTRICTED APPLICATION
PACKAGES, read and execute. LPAC honours that grant by design. The CI log lines are kept in
`.evidence/F-005/windows-ci.log` (not tracked).

Proposed SEC-01 wording for Windows (a spec change for the planning session): "Windows: LPAC
AppContainer + job object. Besides its input (passed as a handle), the worker can read only files
whose ACL grants ALL RESTRICTED APPLICATION PACKAGES read/execute (OS and installed program files;
only C:\Windows was measured). Files without that grant, including everything under the user
profile, are denied."

## Requirements for the parse worker

Implemented here and to be ported as is:
1. **Windows input by handle.** No ACE on the input. The parent opens it read-only and passes exactly
   that handle via `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. A later run in the same container can't open
   it by path.
2. **Windows LPAC.** `PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY` =
   `PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT`.

Rules the worker must keep:
3. **No new processes.** `RLIMIT_AS` is per process, so the worker must never be able to fork. On
   Linux, `clone` is allowed only with `CLONE_THREAD`, `clone3` returns `ENOSYS`, and `fork`/`vfork`
   are denied. macOS relies on Seatbelt's `process-fork` denial. Windows relies on the job's
   one-process limit. On Linux the worker also dies with its parent (`PR_SET_PDEATHSIG`). On macOS the
   core must kill it when the app exits; Windows does that through the job's kill on close.
4. **No inherited fds.** Close every fd above 2 before sandboxing (`close_range` on Linux, `/dev/fd` on
   macOS). Landlock and Seatbelt only gate new opens, and seccomp still allows `read`, `write` and
   `sendmsg` on an fd the worker already holds. The worker's stdin/stdout pipes are fds 0 and 1.
5. **`enter()` before any thread.** Landlock's `restrict_self` restricts only the calling thread.
   `enter` refuses if `/proc/self/status` shows more than one thread. If a future ABI's
   `LANDLOCK_RESTRICT_SELF_TSYNC` is available, the worker may use it as well.
6. **Windows IPC handles.** The worker's pipe handles go through the same `HANDLE_LIST`, never through
   `bInheritHandles = TRUE` alone, which would leak every inheritable handle in the core.
7. **Parent-death on Linux (ROB-40).** `PR_SET_PDEATHSIG` fires when the spawning *thread* exits, not
   the process. A tokio blocking-pool thread retires after about 10 s, so the core must spawn workers
   from one long-lived thread. The prctl also runs after exec, so a core that died before it leaves
   the worker running. The core passes its pid, and after the prctl the worker compares `getppid()`
   with it and exits if they differ.
8. **Windows input handle stays private (SEC-01).** `SetHandleInformation(HANDLE_FLAG_INHERIT)` leaves
   the handle inheritable in the core while the process starts. A concurrent `CreateProcess` with
   `bInheritHandles = TRUE` (for example std `Command`) could receive it. Either open it
   non-inheritable and `DuplicateHandle` it into the suspended child, or hold std's spawn lock and
   clear the flag right after `CreateProcessW`. The spike uses the simple flag because its tests
   start nothing else concurrently.
9. **Windows system files stay readable under LPAC.** The `cannot_read_a_system_file` test fails
   there by design of LPAC; its assert prints the file's SDDL. If the parse worker must close this
   gap, it should attempt the Chromium-style lockdown token (restricted token, startup
   impersonation; preserved at commit 30934ba) in a feature of its own. That attempt also has to
   solve start-up DLL loading, which failed with 0xC0000135.
10. Not covered here: the 60 s time limit (a wall-clock kill in the core). The seccomp filter should
   become an allow list once the worker's syscalls are known. macOS `sandbox_init` is deprecated but
   still shipped (Chromium uses it).
