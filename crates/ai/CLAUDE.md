# lecter-ai

Provider adapters, agent loop, roles, tools, prompt assembly and caching, web search, figures, usage and budgets.
Spec: `06-ai-harness.md`, `07-providers.md`, `08-figures.md`, `05-retrieval.md#tiers`, `#token-budgets`.

## Invariants

- Principle 1: the best answer for the fewest tokens and the lowest latency. Before adding anything to a prompt, ask what it costs per request and whether it can sit in the cached prefix instead.
- Prefix order is fixed and byte-stable for cache hits: system → role → AGENTS.md → skills index → memory.md → course card → digest → current lecture. Any change to the prefix assembly needs a test proving that two identical requests produce byte-identical prefixes.
- Uncached input for `a` ≤ 2,500 tokens (p95). Tool results are trimmed to 1,500 tokens with a "read more" path. Usage is logged per request.
- Lecter's own time-to-first-token overhead is < 20 ms against the fake provider. Pre-warm, hedge after `ai.hedgeAfterMs`, use a circuit breaker per provider, and have `Esc` cancel the stream immediately.
- The only write path is `note_actions`, and each action is visible and undoable. There are no shell, file-write or network tools.
- Slide, source and web text is always wrapped in `<untrusted_source>`.
- `memory.md` changes only from the user's ratings.
- Web search precedence: prompt > role > course > global, with modes `native | service | off`. Use the provider's native search when available.
- Sign-in methods follow `07-providers.md#sign-in` exactly. There is no Anthropic subscription OAuth (provider terms). Each method sits behind a build-time flag.
- Figures: proposals obey `figures.mode.*` (Auto/Ask). Page figures run only in the sandboxed iframe from `08-figures.md#sandbox-pages`.
- Tests use `tests/fake-provider/` (scripted SSE: slow first token, 429, 5xx, drops, malformed). Real providers run only in live spikes and the AI eval, through `scripts/live.sh` (rate-limited; SEC-15).

## Learned

