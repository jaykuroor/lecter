# 07 · Providers and models

Users connect AI the opencode way: `:connect` or Settings → Providers lists providers; the user signs in, pastes a key, or gives a local server address; Lecter tests the connection immediately.

## Adapters (one Rust trait)

```rust
trait Provider {
    fn id(&self) -> &str;
    async fn stream(&self, req: ChatRequest, cancel: CancelToken) -> Result<EventStream>;
    fn capabilities(&self, model: &str) -> Caps; // tools, vision, native_search, caching, structured_output
}
```

v0 adapters: Anthropic Messages API, OpenAI Responses API, Google Gemini API, OpenAI-compatible Chat Completions (covers OpenRouter, Groq, Ollama, LM Studio, llama.cpp, vLLM and most others). Raw HTTP + SSE; no vendor SDKs.

## Sign-in

| Provider | Methods in v0 |
|---|---|
| OpenAI | ChatGPT Plus/Pro browser sign-in (as opencode offers), or API key |
| GitHub Copilot | Device-code sign-in |
| xAI | SuperGrok device-code sign-in, or API key |
| Anthropic | API key only. Anthropic's terms (Feb 2026) forbid third-party apps from using Claude Free/Pro/Max logins |
| Google Gemini | API key |
| OpenRouter, Groq, others | API key |
| Local servers | Base URL (no key) |

Before each release, re-check each provider's terms. Each sign-in method sits behind a build-time flag so it can be switched off in an update (there is no remote kill switch). Tokens and keys live in the OS keychain. Subscription sign-in must not be used for features the provider doesn't offer to it (for example embeddings), unless the provider documents it.

## Models

- The model list comes from the models.dev catalog (context size, output limit, price, vision, tools, caching), cached in the data folder and refreshed weekly. Users can add models by hand.
- **default-fast** and **default-strong** are chosen at connect time from the catalog's recommendations for that provider (for example a Flash, Haiku or mini-class model for fast; a Sonnet-class or similar for strong). The user can change both.
- Per role: `model` in the role file or Settings → AI. Per prompt: model picker button in the prompt row, or `@model-name`.
- Lecter warns when a role needs a capability the chosen model lacks (tools, vision) and falls back to default-fast if it has it.

## Speed tracking

For each model, keep a rolling average of time to first token and output tokens per second (last 50 requests) in `state.db`. Used for figure time estimates and for picking the hedging backup.
