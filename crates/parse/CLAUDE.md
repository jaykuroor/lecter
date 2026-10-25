# lecter-parse (sandboxed worker binary + library)

Reads ONE untrusted file and returns blocks, layout, crops and figure-card inputs.
Spec: `04-parsing.md` (all of it), `13-security.md` (first row), `01-architecture.md#processes`.

## Invariants

- Runs as a child process: no network, read access to its one input file only, 1 GB memory limit, 60 s per file. Sandbox:
  - Linux: seccomp + Landlock.
  - macOS: sandbox profile.
  - Windows: AppContainer or restricted token + job object.
- **Zip:** ≤ 200 MB uncompressed, compression ratio ≤ 100, no path traversal in entry names.
- **XML:** `quick-xml` with no DTD processing and no external entities.
- `.tex` is never compiled.
- Reading ladder order:
  1. source structure;
  2. PDF text layer;
  3. vision (provider by default; the local model is opt-in via `parsing.vision`);
  4. render-back check;
  5. user fix.
  Never call vision on a page whose text layer passes the confidence check.
- Cache by BLAKE3 of the file bytes in `.lecter/cache/parse/`. The same file is never parsed twice.
- A 100-page text-layer PDF must parse in under 1 s. Measure with `cargo bench -p lecter-parse`.
- Build-step merging (PDF overlays) follows `04-parsing.md#build-steps-pdf` exactly.
- PDFium is loaded dynamically from the bundled per-OS binary. Never link MuPDF (AGPL).

## Tests

- Fuzz targets for each reader live in `crates/parse/fuzz/`. Keep their corpora small and checked in.
- Score parse quality with the corpus scorer in `tests/corpus/` (CER, LaTeX exact match, render-back score).
- `cargo nextest run -p lecter-parse`

## Learned

- PDFium binds once per process: tests share one `OnceLock<Pdfium>` per test binary, and find the verified library by walking up from `CARGO_MANIFEST_DIR` (cargo-mutants copies the tree under `.verify/` without `target/`) (F-019)
