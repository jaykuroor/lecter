# 04 · Parsing

Every file is parsed **once**, when it is added, into the block model: Markdown + LaTeX blocks, plus a **figure card** per figure. After that the AI reads text, not page images. Images are sent to a model only when a question is about a figure.

Why: a 1920×1080 slide as an image costs about 2,800 input tokens on Claude, 2,000 on GPT and 1,500 on Gemini. As text it is usually 50–300 tokens.

## Reading ladder

Each region stops at the first step that reads it with confidence ≥ 0.95, or the best result after step 4.

1. **Source structure.** PPTX: text, OMML math → LaTeX, tables, speaker notes, build order from `p:timing` / `p:bldLst`. No model.
2. **PDF text layer.** PDFium words and positions; layout rules rebuild reading order, headings, lists, columns. Math glyph regions are marked for step 3/4 (the text layer has no fraction or root structure).
3. **Image regions → vision.** Default (`parsing.vision = "provider"`): the user's provider vision model, using the fast model, one region or page per request, with a fixed prompt that returns Markdown + LaTeX + a confidence. Opt-in (`parsing.vision = "local"`): local document model PaddleOCR-VL-1.6 (0.9B, Apache-2.0) via the model worker; GLM-OCR (0.9B, MIT) as alternative. `"auto"` uses local when available and confident, provider otherwise. `"off"` keeps the crop only.
4. **Render-back check.** For math and tables: render the result (KaTeX → SVG → raster) and compare with the crop (SSIM on binarized images). Score = min(model confidence, match score).
5. **The user.** `gx` shows original beside parse; `i` edits; the fix is stored and wins.

Confidence borders: none for ≥ 0.95 (source or text layer); thin dotted for 0.85–0.95; amber dotted with a badge below 0.85.

Region resolution: a math or text region rendered at less than about 20 px x-height is re-rendered from vector PDF at 4×, or the largest embedded copy of the image is extracted first.

## Cases

| Material | How it is read |
|---|---|
| Clean bullet slides | Steps 1–2 only. Zero tokens |
| Graphic-heavy, animated PPT | Build order from the file, or merged PDF build pages. One figure card per figure |
| Text-dense PDF (handouts, papers, textbooks) | Text layer + layout. Headings and the PDF outline form a section tree (used by retrieval) |
| Scans, photos, handwriting | Step 3 for the whole page |
| Math-heavy slides | Step 3 on a high-resolution vector render + step 4 |
| Tables | Markdown table, or HTML if cells merge |
| Charts | Figure card with a data table when axes are readable |
| Code slides | Code block, language detected |
| Several files in one lecture | Same block model, ordered by front matter (`A3`, `B1`) |
| Video or GIF | Poster frame + figure card |

## Build steps (PDF)

Consecutive pages form one slide with a stepper when: the title text is identical, page N's text is a superset of page N−1's, and a 64 px-wide grayscale diff shows changes only in added regions. Merged slides keep every page number.

## Figure cards

Written once per figure (cache key = crop hash) by the fast vision model with this output shape, about 100 tokens:

```json
{ "what": "Four scatterplots, r = 0.9, 0.5, 0, -0.8", "labels": ["x", "y"], "data": null,
  "takeaway": "Points tighten around a line as |r| grows", "confidence": 0.9 }
```

Stored in `state.db`; inserted in the lecture as a dotted-border block under the figure; indexed for search.

## File types

v0: PDF, PPTX/PPSX/POTX, PNG/JPEG/HEIC/WebP, multi-page TIFF. Sources also accept EPUB and DOCX (text only). Later: see `15-later.md`.

## Where and when

- Parsing runs in the parse worker when a file appears in `slides/` or `sources/` (file watcher), or when a lecture is created. The visible slide goes first.
- Results are cached by BLAKE3 hash of the file in `.lecter/cache/parse/`. No file is parsed or described twice.
- A 100-page text-layer PDF must parse in under 1 s (budget in `14-quality.md`).
- Size, page, pixel and depth limits for every input: `13-security.md#untrusted-files` (SEC-01 to SEC-05).
