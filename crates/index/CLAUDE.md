# lecter-index

Tantivy BM25, flat int8 vectors, RRF fusion, section trees, course card, digest, concept map, past papers.
Spec: `05-retrieval.md` (all), `02-course-folder.md#course-details-coursejsonc`.

## Invariants

- No vector database. Use a flat int8 scan over memory-mapped vectors, and fuse with BM25 by RRF (k = 60).
- Tier-1 pre-retrieval < 100 ms p95 on the fixture course (1 textbook of ~600 pages + 10 lectures).
- Embeddings are set by `index.embeddings`: `local-small` (default) | `local-quality` | `provider` | `off`. With `provider`, the vectors are stored locally, so they are never re-embedded per query. The chosen default must match the F-003 spike decision.
- Each chunk carries where it comes from (source, section path, page). There are no model-written context lines unless `index.contextLines` is on (default off).
- No GraphRAG in v0. The concept map is built from section trees and tags only, with no extra LLM calls.
- Indexing runs at background priority and stops when the user starts an AI request.

## Learned

