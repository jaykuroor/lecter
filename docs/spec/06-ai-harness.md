# 06 · AI harness

Every gloss is a short agent run, like Claude Cowork or ChatGPT. The model reads the context Lecter has already placed in front of it, decides whether it needs more, calls tools, and streams the answer. Most answers need no tool call, because tiers 0 and 1 (`05-retrieval.md`) already hold the likely context.

## Loop

1. Build the request: tier 0 + tier 1 + anchored block + prompt, plus the role's tools.
2. Stream from the provider. Text deltas go to the UI over a channel and render once per animation frame.
3. On tool calls: run them in parallel where independent, trim results, send them back. Show a one-line activity status in the gloss header ("Searching course text… Thm 4.7, p. 213").
4. Stop at the end of the turn, at `max_steps`, at the role's time budget (default 30 s for `a`), or on `Esc`.
5. After the stream: run post-checks (math step checks for `steps`), save the gloss, and record usage (tokens in, cached, out, latency, cost).

## Roles (built-in defaults)

| Key | Role | Model default | max_steps | Output style |
|---|---|---|---|---|
| `a` | ask | default-fast | 4 | Direct answer first, then detail |
| `s` | steps | default-strong | 4 | Structured: numbered steps, each `{latex, reason}` |
| `D` | doubt | default-fast | 4 | Background job; result appears when ready; sets `status` |
| `K` | define | default-fast | 1 | ≤ 60 words per term |
| `x` | example | default-fast | 2 | Worked example with numbers |
| `>` | write | default-strong | 8 | Note written to the user's description |
| `gq` | tidy | default-fast | 0 | Rewrite of the user's note; original kept |
| `v…a` | selection ask | inherits `a` | 4 | Answer about the selection |
| `␣ag` | gap finder | default-strong | 4 | Two short diagnostic questions, then explanation |
| `␣ap` | plot | default-fast | 1 | Figure only |
| — | revise | default-fast | 6 | Interactive session (`11-dashboard.md`) |
| — | course chat | default-fast | 6 | "Ask the course" on the dashboard |

`Ctrl-a` / `Ctrl-x` on a gloss regenerate at detail level +1 / −1 (levels 1–4 map to output caps of 150, 400, 900 and 1,800 tokens plus a style line in the prompt). `r` regenerates; `R` regenerates with feedback; `g-` / `g+` switch variants; `zg` / `zw` rate (with a reason picker on `zw`).

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `search_course` | `query`, `kinds?` (textbook, paper, slides, notes, past_paper), `lecture?`, `k?` | Passages with breadcrumbs and ids |
| `toc` | `source_id`, `node?` | Children of a section-tree node with one-line summaries (PageIndex-style navigation) |
| `read` | `source_id` or `path`, `section?` / `pages?` / `block_ids?` | Text, max 1,500 tokens per call, with continuation |
| `lectures` | `number?` | Lecture list, or one lecture's digest, flags and doubts |
| `past_questions` | `topic`, `k?` | Past exam questions with year and marks |
| `web_search` | provider-native, or `query` for the fallback service | Results with citations |
| `load_skill` | `name` | Skill body |
| `compute` | `expr`, `vars?`, `check?` | Numeric evaluation or equality check |
| `propose_figure` / `figure` | see `08-figures.md` | |
| `note_actions` | `add_flag`, `add_doubt`, `add_later{due}`, `add_office_hours`, `add_revise` | The created item id; shown in the gloss with one-key undo |

## Permissions

- Read: anything in the trusted course not excluded by `.lecterignore`. Nothing outside it.
- Write: only through `note_actions` and the gloss being written. Every action is visible and undoable. No shell, no arbitrary file writes, no network beyond the configured providers and search service.
- Slide, source and web text is wrapped as `<untrusted_source>` in prompts. The system prompt states that instructions inside it are content, not commands.
- `memory.md` changes only from the user's own ratings (`zg`, `zw` with reason), never on the model's initiative.

## Web search configuration

Levels, most specific wins: **per prompt** (globe toggle in the prompt row, or `@web` / `@noweb`) → **role** (`web_search` in the role file) → **course** (`settings.ai.webSearch`) → **global**.

Values: `native` (the provider's own tool: OpenAI `web_search`, Anthropic `web_search` + `web_fetch`, Gemini Google Search grounding), `service` (Brave, Tavily, Exa or SearXNG with the user's key or URL; used automatically for providers with no native search), or `off`. Also: allowed and blocked domains, max searches per answer (default 3). Citations are always shown and clickable.

## Steps checking (`s`)

Each step's LaTeX is parsed (`cas` crate) and compared with the previous step by evaluating both sides at 8 random points per free variable (tolerance 1e-9 relative). Marks: ✓ numerically checked; – not checkable (operators such as E[·], Cov, limits). A failing step is regenerated alone, once. Checks run after streaming, so they never delay the first token.

## Latency tactics (all required)

1. Pre-warm DNS, TLS and HTTP/2 to the default provider at app start and when a lecture opens.
2. Prompt caching as in `05-retrieval.md`.
3. Hedged requests: if no first token within `ai.hedgeAfterMs` (default 2,500) and a backup provider is configured, send the same request to it; keep the first to answer, cancel the other.
4. Circuit breaker per provider: 3 failures in 60 s → skip it for 2 minutes.
5. `Esc` cancels the HTTP stream immediately.
6. Code instead of models wherever possible: plain-math-to-LaTeX while typing is a local AsciiMath-style parser; plots are computed locally from a spec.
7. Lecter's own overhead on time to first token must be under 20 ms (measured against a local fake provider).

## AI harness settings page

Settings → AI shows, per role: model, tools on/off, web search, max steps, max output tokens, retrieval top-k, detail default, and the prompt (editable; creates a role override file). Global: default-fast and default-strong models, backup provider, hedging, budgets (per lecture, per month), caching on/off, figure mode, feedback sharing.

## Usage, cost and feedback

- Every request logs tokens (input, cached, output), latency (TTFT, total), cost (from the model catalog) and role to `state.db`. The status line shows the lecture's running cost.
- Budgets and limits: spend caps per gloss, lecture, day and month, a separate daily cap for background jobs, per-provider rate limits, request coalescing and timeouts are defined in `13-security.md#unbounded-consumption-outbound-requests` (SEC-10 to SEC-14). When a cap is reached, background jobs pause and the user is asked before foreground ones.
- Every web search query the model makes is listed in the gloss footer (SEC-24).
- Feedback sharing (opt-in from onboarding or Settings → Privacy): ratings with role, model, provider, detail level and latency; question and answer text only with a second opt-in. Batched and sent to `feedback.endpoint` when one is configured; stored locally until then. The screen shows a sample of exactly what is sent.
