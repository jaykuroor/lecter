# Spike F-006: PDFium bundling per OS

**Question.** Can Lecter ship a pinned, checksum-verified PDFium for every packaged target
(`01-architecture.md#packaging`) and load it dynamically through `pdfium-render`
(`#stack-decided`), with the download refused on a SHA-256 mismatch (SEC-51)?

**Answer: GO.** Source and pinning are the maintainer's D-084.

## What is pinned

`pins.json` is the single source of truth: one release tag of
[bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries), and per target the asset,
its SHA-256 and the library's path inside the archive.

- Tag `chromium/7881` (PDFium 151.0.7881.0, published 2026-06-08, more than 2 weeks old). Chosen
  because it matches `pdfium-render` 0.9.4's newest API feature, `pdfium_7881`, so every symbol the
  bindings resolve exists in the library. A newer PDFium with older bindings risks a missing symbol at load.
- The pins were taken from GitHub's release asset digests and re-checked with `sha256sum` on the downloads.
- Licence: PDFium BSD-3-Clause AND Apache-2.0 (`licenses/pdfium.txt` in the archive holds both texts). The library statically
  contains third-party code (FreeType, ICU, libjpeg-turbo, OpenJPEG, libtiff, libpng, lcms, zlib, abseil,
  AGG, fast_float, simdutf, llvm-libc), each with its notice in `licenses/`. The build scripts are MIT
  (`LICENSE`). The script places `LICENSE` and `licenses/*` next to the library so the bundle step can
  ship them in About → Licences (SEC-52).

| Target | Asset | Archive | Library |
|---|---|---|---|
| linux-x64 | pdfium-linux-x64.tgz | 3.6 MB (3 644 759 B) | libpdfium.so 7.6 MB (7 645 184 B) |
| linux-arm64 | pdfium-linux-arm64.tgz | 3.6 MB (3 588 127 B) | libpdfium.so 7.8 MB (7 834 256 B) |
| macos-universal | pdfium-mac-univ.tgz | 7.0 MB (7 006 774 B) | libpdfium.dylib 15.2 MB (15 219 824 B) |
| windows-x64 | pdfium-win-x64.tgz | 3.7 MB (3 733 154 B) | pdfium.dll 7.2 MB (7 211 520 B) |
| windows-arm64 | pdfium-win-arm64.tgz | 3.5 MB (3 522 432 B) | pdfium.dll 6.7 MB (6 658 048 B) |

## How the script works (`fetch_pdfium.py`)

1. Gets the archive bytes into memory **once**: from the cache `target/pdfium/<tag>/<asset>`
   (git-ignored), or downloaded from `<source>/releases/download/<tag>/<asset>` (64 MiB cap, 30 s read
   timeout, 90 s per attempt, 3 attempts, Content-Length check; the sandbox proxy once delivered a
   truncated body, which the SHA check caught).
2. Hashes that buffer **on every run**, cached or not. A mismatch deletes the cached archive, exits 3
   and places nothing.
3. Opens the tar from the **same buffer** (`io.BytesIO`), never by path after verifying, and reads
   only the library, `LICENSE` and `licenses/<file>` (regular files only, each under the cap; nothing is
   extracted by member name). They go to `target/pdfium/<tag>/<target>/`. A file already there is kept
   only if it is byte-identical to the verified copy, so a tampered library on disk is replaced.
4. Several test processes share the cache and CI starts cold. Every write goes through a temp file
   and `os.replace`. If the destination already holds identical bytes (another process won the
   race), the temp file is discarded. On Windows a replace onto a file another process holds open
   (being hashed, or a loaded `pdfium.dll`) fails with PermissionError. The script retries
   briefly, re-checks for identical bytes, and otherwise exits with a message, not a traceback.
5. `--report` prints each target's SHA-256 **computed from the bytes**. The test compares it with
   `pins.json`, then corrupts every archive and checks that each target exits 3 with no library placed.

## Rerun

```sh
python3 spikes/pdfium/fetch_pdfium.py --all --report    # all five targets, sizes, SHA OK
cargo nextest run -p lecter-spike-pdfium                 # criteria 1 and 2 on the host OS
```

The tests call the script themselves. On every OS they use the first of `python3`, `python` and
`py` that passes a one-line Python 3 probe, so the Windows Store stub (it starts, exits 9009 and
prints nothing) is skipped. CI's normal `test`
job on ubuntu-24.04, macos-15 and windows-2025 downloads and verifies the host library with no CI change.
`all_five_targets_download_and_match_their_pins` fetches all five (~21 MB) on each OS. The network
exception for this crate's tests is D-086.

Tests: `tests/checksum.rs` (all five verify; a wrong pin is refused; a corrupted archive is refused
and deleted; no library placed in either case) and `tests/load.rs` (dynamic load through
`pdfium-render`, page-1 text of a synthetic one-page PDF generated in code; no PDF file is committed).

## How the bundle step will place the library (carry forward)

- **Build:** the release workflow runs the same pinned download for the target it builds (the script
  logic, or a Rust `xtask` port of it reading `pins.json`) before `tauri build`. No unverified bytes reach the bundle.
- **Linux (AppImage, .deb, .rpm, Flatpak):** `libpdfium.so` as a Tauri `bundle.resources` entry, so
  it lands in the app's resource dir (`/usr/lib/<app>/` for .deb/.rpm, inside the AppDir for AppImage).
- **macOS:** `libpdfium.dylib` (universal; one file covers Apple Silicon and Intel) in
  `Contents/Frameworks` through `bundle.macOS.frameworks`, signed and notarized with the app.
- **Windows (x64, ARM64):** `pdfium.dll` next to `lecter.exe` (Tauri resources at the install root),
  signed with the installer.
- **Load:** the parse worker resolves the resource dir at startup and calls
  `Pdfium::bind_to_library(<dir>/<platform library name>)` with an absolute path. Never
  `bind_to_system_library`, so a PDFium on the user's `PATH`/`LD_LIBRARY_PATH` is never picked up.
  `pdfium-render` allows one binding per process, which fits one long-lived worker.
- **Licences:** ship `LICENSE` and `licenses/*` from the same archive into the About → Licences data.
### Requirements for real packaging

1. **A port must keep the script's guarantees.** An `xtask` or release-workflow port of the download must:
   hash the archive and extract from the **same in-memory buffer**, never reopening it by path after
   verifying; keep an existing library only if it is byte-identical to the verified copy; and refuse
   any wanted member that isn't a regular file, or that is over the size cap.
2. **The worker loads by absolute path.** It must call `Pdfium::bind_to_library` with the absolute
   path to the library in the app's resource dir, and never `bind_to_system_library`. A test in the
   parse crate must check this path resolution: the resolved path is absolute and inside the resource
   dir, and loading doesn't fall back to a library on the search path.
3. **Licences ship explicitly (SEC-52).** `cargo-about` and the npm licence lists can't see a native
   binary. The About → Licences generator must add PDFium's `LICENSE` and every `licenses/*` file from
   the verified archive itself, and a build check must fail if any of them is missing from the bundle.

- **Updating PDFium:** bump the tag and all five pins together with the matching `pdfium-render`
  API feature (`pdfium_<build>`), then rerun this spike's tests on all three CI OSes.

## Dependency

`pdfium-render` 0.9.4 with `default-features = false`, features `thread_safe` and `pdfium_7881`
(no `image` crate, no static linking): 9 new crates, MIT OR Apache-2.0. Flagged native by
`check_deps.py` because it loads PDFium; approved by D-084 (the binary) and D-085 (the crate).
