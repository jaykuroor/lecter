# 15 · Later (do not build in v0)

Listed so the v0 design leaves room for them. An agent must not implement anything here unless `docs/features.json` contains it.

## v1

- Live transcript (`:live`): VAD-gated local speech-to-text (whisper.cpp / Moonshine / Parakeet), WebVTT, audio retention opt-in; rewind `⌫`; catch-up `c`; live-slide inference from transcript and `gl`/`gL`; nudges.
- Flashcards with spaced repetition (FSRS), Anki export; quick checks; try-first mode.
- Study pack on `:wq`; pre-class prep (`:prep`, batch API).
- Board photos (paste, watched folder; later phone pairing by QR code).
- More formats: ODP, Keynote (macOS export), Google Slides, Beamer source, Marp, reveal.js, Quarto, Typst, Jupyter, DjVu, old PPT via LibreOffice.
- Floating terminal (`Ctrl /`) and the `lecter` CLI (`export`, `doubts`, `ask`).
- Symbolic CAS checks for steps; compare two providers side by side (`␣aM`).

## Later

- Plugins and Lua scripting.
- Tablet apps (Tauri mobile targets).
- Graph-based retrieval if revise and gap-finder quality needs it.

## Business (Jay's future plans)

- Opencode-style model: the app stays free and open source; optional paid services later.
- A "Lecter" provider for hosted, fine-tuned or discounted models.
- Cloud storage and sync of course folders.
- A feedback endpoint for opted-in ratings (v0 stores locally until `feedback.endpoint` is set).
