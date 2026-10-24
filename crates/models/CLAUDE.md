# lecter-models (opt-in worker binary)

Local document model (vision) and local embeddings. It is off unless the user opts in. Default users never download anything.
Spec: `04-parsing.md#reading-ladder`, `05-retrieval.md#search`, `01-architecture.md#processes`.

## Invariants

- The worker starts on demand and exits after 60 s idle. Nothing is resident while unused.
- Downloads:
  - only after explicit consent;
  - the size is shown first;
  - checksums are verified;
  - the download is resumable.
- The worker is sandboxed with no network, except the download step, which runs in the core.
- Must run on CPU-only machines with 8 GB RAM. Detect a GPU and use it if present; never require one.
- Use ONNX Runtime or a llama.cpp server. Pick per D-entry from the F-002 and F-003 spikes.

## Learned

