# 05 · Retrieval and context

Goal: the best answer for the fewest tokens and the least latency. A small, cached picture of the whole course goes in every prompt. A fast local hybrid search runs before the model is called, and agent tools handle anything deeper. No graph RAG in v0.

Research basis (Oct 2026): agentic search with tools has replaced pure vector RAG as the default for coding agents, with a small vector layer kept for meaning-based lookups. Hybrid BM25 + dense search fused with RRF is the baseline. Adding where a chunk comes from cut retrieval failures by 35–67%. Graph RAG costs thousands of indexing calls and 37–70 s per query on course material, and it wins only on broad thematic questions. Sources are in the v0 spec doc.

## Tiers

| Tier | Content | When |
|---|---|---|
| 0 · cached prefix | Lecter system prompt → role prompt → global + course `AGENTS.md` → skill index (names + descriptions) → `memory.md` → course card (~500 tokens) → course digest (≤150 tokens per lecture) → current lecture text (slides + glosses + notes; long lectures: the current slide ± 3 in full, the rest as headings) | Every request. Order never changes, so provider caching hits |
| 1 · pre-retrieval | Top-k passages (default 5) from local hybrid search over the question + the anchored block text, each with a breadcrumb header ("Course text › Ch 4 › 4.3 Properties › p. 213") | Before the model call, under 100 ms |
| 2 · tools | `search_course`, `toc`, `read`, `lectures`, `past_questions`, `web_search` | Only when the model decides |

Message layout for caching: `system` = tier 0 up to and including the course digest (cache breakpoint), then the current lecture (cache breakpoint), then a user message with tier 1 passages + anchored block + question. Anthropic: explicit `cache_control` breakpoints. OpenAI and Gemini: stable prefix ordering (implicit caching). Warm the cache with a 1-token request when a lecture opens.

## Indexing

All indexing is local and spends **no model tokens** by default.

| Source | Indexed as |
|---|---|
| Textbooks | Section tree from the PDF outline, else from detected headings. 300–500-token passages that never cross a section boundary. Theorems, definitions, examples and exercises tagged by number (`Thm 4.7`) for exact lookup |
| Papers | Same; the abstract is the paper's summary node |
| Slides (all lectures) | Blocks + figure cards, one passage per slide |
| Notes | Glosses and own notes; flags, doubts and kinds as fields |
| Past papers | Split into questions with year, number, marks; topics matched to course-card topics by embedding similarity |
| Syllabus | Course card (one model call at setup, user confirms) |

Every passage stores its breadcrumb, which is indexed and shown to the model (free "contextual retrieval" from structure). Optional, off by default (`index.contextLines`): model-written one-line context per passage, about $0.50 per 500-page book with a cheap model; offered when a large book is added.

Course digest: when a lecture is saved and changed since the last digest, the fast model writes a ≤150-token summary (topics, key results, open doubts). Debounced to at most one call per lecture per 10 minutes.

Concept map (free): definitions, theorems and their lecture ↔ book-section links (from retrieval similarity) stored in `state.db`. Used by the gap finder and revise sessions.

## Search

- BM25: Tantivy, fields `text`, `breadcrumb`, `tags`, `kind`, `source`, `lecture`.
- Vectors: embedding model per `index.embeddings`. Default `local-small` (nomic-embed-text-v1.5 class, 137M, Apache-2.0, Matryoshka-truncated to 256 dims, int8). Options: `local-quality` (Qwen3-Embedding-0.6B), `provider` (OpenAI or Gemini embeddings API; vectors stored locally), `off` (BM25 only). Phase 0 compares them on a real course and sets the default.
- Storage: one int8 matrix per course in `.lecter/cache/vectors.bin`; flat dot-product scan (60k passages × 256 dims ≈ 15 MB, a few ms).
- Fusion: reciprocal rank fusion, k = 60. No reranker in v0 (the model reads 5 short passages).
- The embedding model loads only for indexing and queries, and unloads after 60 s idle.

## Per-role policy (defaults; all configurable in each role file)

| Role | Tier 0 | Tier 1 | Tools | Web search |
|---|---|---|---|---|
| define (`K`) | yes | top 3 + exact glossary hit | `search_course` | inherit |
| ask (`a`) | yes | top 5 | all read tools | inherit |
| steps (`s`) | yes | top 3 + matching book section | read tools, `compute` | inherit |
| example (`x`) | yes | top 3 | `compute`, `figure` | inherit |
| doubt (`D`) | yes | top 5 | all read tools | inherit |
| write (`>`) | yes | top 8 | all | inherit |
| gap finder (`␣ag`) | yes + concept map | top 5 | read tools | inherit |
| revise session | yes | flags + doubts + past questions for the topic | read tools | inherit |

`inherit` resolves per prompt toggle → role file → course setting → global setting (`ai.webSearch`, default `native`).

## Token budgets

Targets for an `a` request: uncached input ≤ 2,500 tokens (tier 1 + anchored block + question); cached prefix any size up to `ai.maxPrefixTokens` (default 30,000). Tool results are trimmed to 1,500 tokens each, with a path to read more. Budgets are measured and logged per request (see `14-quality.md`).
