# spikes/ (M0 measurements, not shipped)

Each spike gets a folder `spikes/<name>/` with:

- `README.md` covering the question, method, how to rerun, and results;
- a script that reproduces the numbers.

Code here may be rough, but the numbers must be reproducible. The deliverable is a D-entry with the measurements and a go/no-go or chosen default.

Spikes never become dependencies of `crates/` or `ui/`. Port what you learned; don't import it.

- **Live providers** only through `scripts/live.sh F-0NN -- <cmd>`. It loads Jay's keys into that one command and asks Jay to approve each run. Read the limits it exports (`LECTER_LIVE_RPM`, `LECTER_LIVE_RPD`, `LECTER_LIVE_TPM`; Gemini free-tier defaults), keep a token bucket, honour `retry-after`, back off with jitter on 429, and save partial results when the daily cap is reached so a rerun continues instead of starting over.
- **Cross-OS spikes** (sandboxes, PDFium, IME, figure frame) can't be run on macOS or Windows here: put the measurement in a CI job matrix (`.github/workflows/spikes.yml`, `workflow_dispatch`), and report the CI run's numbers.
- Private corpus results: manifest ids and aggregate numbers only.

## Learned

