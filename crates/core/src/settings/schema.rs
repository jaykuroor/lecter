//! The settings types (`12-settings-theme-onboarding.md#settings`). `settings.schema.json` is
//! generated from them ([`schema_json`]); never hand-edit it.
//!
//! Only keys whose type and default the spec states are here. A feature that needs another key
//! adds it to these types and regenerates the schema. Every field has a default, so a settings
//! file may name any subset of keys.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Lecter's settings. Files nest keys (`{"ui": {"performance": "quality"}}`); the dotted name
/// `ui.performance` is the same key. A course's `course.jsonc` puts them under `"settings"`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
#[schemars(title = "Lecter settings")]
pub struct Settings {
    /// AI models, web search and spend caps.
    pub ai: Ai,
    /// When Lecter turns figures into live plots.
    pub figures: Figures,
    /// How slides are read.
    pub parsing: Parsing,
    /// The course search index.
    pub index: Index,
    /// The window and the editor.
    pub ui: Ui,
    /// What leaves this machine. Only the global config.jsonc may set these.
    pub privacy: Privacy,
    /// Where opted-in feedback goes. Only the global config.jsonc may set these.
    pub feedback: Feedback,
    /// What the logs may hold. Only the global config.jsonc may set these.
    pub log: Log,
    /// Size limits on what Lecter reads. Only the global config.jsonc may set these.
    pub limits: Limits,
}

/// `ai.*`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Ai {
    /// The fast default model (a model id); unset picks the provider's.
    pub default_fast: Option<String>,
    /// The strong default model (a model id); unset picks the provider's.
    pub default_strong: Option<String>,
    /// The provider a hedged request goes to; unset turns hedging off.
    pub backup_provider: Option<String>,
    /// Milliseconds without a first token before a hedged request is sent.
    pub hedge_after_ms: u32,
    /// Web search in answers.
    pub web_search: WebSearch,
    /// The largest cached prompt prefix, in tokens.
    pub max_prefix_tokens: u32,
    /// How web search runs.
    pub search: Search,
    /// Spend caps. A course may lower them, never raise them.
    pub budget: Budget,
}

impl Default for Ai {
    fn default() -> Self {
        Self {
            default_fast: None,
            default_strong: None,
            backup_provider: None,
            hedge_after_ms: 2_500,
            web_search: WebSearch::Native,
            max_prefix_tokens: 30_000,
            search: Search::default(),
            budget: Budget::default(),
        }
    }
}

/// `ai.webSearch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WebSearch {
    /// The provider's own search tool.
    Native,
    /// A search service with the user's key or URL.
    Service,
    /// No web search.
    Off,
}

/// `ai.search.*`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Search {
    /// The search service for `ai.webSearch = service`.
    pub service: Option<SearchService>,
    /// The most searches one answer may make.
    pub max_per_answer: u32,
    /// Only these domains are searched; empty means any.
    pub allow_domains: Vec<String>,
    /// These domains are never searched.
    pub block_domains: Vec<String>,
    /// Lets Anthropic's `web_fetch` open pages a result names.
    pub allow_fetch: bool,
}

impl Default for Search {
    fn default() -> Self {
        Self {
            service: None,
            max_per_answer: 3,
            allow_domains: Vec::new(),
            block_domains: Vec::new(),
            allow_fetch: false,
        }
    }
}

/// `ai.search.service`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SearchService {
    /// Brave Search.
    Brave,
    /// Tavily.
    Tavily,
    /// Exa.
    Exa,
    /// A SearXNG instance.
    Searxng,
}

/// `ai.budget.*`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Budget {
    /// US dollars per lecture; unset means no per-lecture cap.
    pub per_lecture: Option<f64>,
    /// US dollars per day.
    pub daily: f64,
    /// US dollars per month.
    pub monthly: f64,
    /// Tokens per month for models with no catalog price.
    pub monthly_tokens: u64,
}

impl Default for Budget {
    fn default() -> Self {
        Self { per_lecture: None, daily: 1.0, monthly: 5.0, monthly_tokens: 2_000_000 }
    }
}

/// `figures.*`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Figures {
    /// When figures become live plots.
    pub mode: FigureModes,
}

impl Default for Figures {
    fn default() -> Self {
        Self { mode: FigureModes { described: FigureMode::Auto, page: FigureMode::Ask } }
    }
}

/// `figures.mode.*`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct FigureModes {
    /// Figures described in a slide's text.
    pub described: FigureMode,
    /// Figures that need the page image.
    pub page: FigureMode,
}

impl Default for FigureModes {
    fn default() -> Self {
        Figures::default().mode
    }
}

/// One `figures.mode.*` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FigureMode {
    /// Make the figure without asking.
    Auto,
    /// Offer it first.
    Ask,
    /// Never.
    Off,
}

/// `parsing.*`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Parsing {
    /// Who reads images and scanned slides.
    pub vision: Vision,
}

/// `parsing.vision`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Vision {
    /// The AI provider.
    #[default]
    Provider,
    /// A local model.
    Local,
    /// The local model when it is good enough, else the provider.
    Auto,
    /// Text layers only.
    Off,
}

/// `index.*`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Index {
    /// How passages are embedded.
    pub embeddings: Embeddings,
    /// Model-written one-line context per passage (costs money).
    pub context_lines: bool,
}

/// `index.embeddings`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Embeddings {
    /// A small local model.
    #[default]
    LocalSmall,
    /// A larger local model.
    LocalQuality,
    /// The provider's embeddings, stored locally.
    Provider,
    /// Keyword search only.
    Off,
}

/// `ui.*`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Ui {
    /// The speed-or-looks preset.
    pub performance: Performance,
}

/// `ui.performance`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Performance {
    /// No Markdown highlighting and no live math.
    Performance,
    /// Highlighting after a 200 ms typing pause; math loads lazily.
    #[default]
    Balanced,
    /// Highlighting and math on every keystroke. Can add input lag on slower machines.
    Quality,
}

/// `privacy.*`. Global only.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Privacy {
    /// Share ratings, model and latency (opt-in).
    pub share_feedback: bool,
    /// Also share question and answer text (a second opt-in).
    pub share_feedback_text: bool,
}

/// `feedback.*`. Global only.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Feedback {
    /// Where opted-in feedback is sent; unset keeps it on this machine.
    pub endpoint: Option<String>,
}

/// `log.*`. Global only.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Log {
    /// Logs may hold prompt, answer and note text.
    pub content: bool,
}

/// `limits.*`. Global only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Limits {
    /// The largest SSE line or JSON event from a provider, in bytes.
    pub provider_line_bytes: u64,
    /// The largest response from a provider, in bytes.
    pub provider_response_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self { provider_line_bytes: 1 << 20, provider_response_bytes: 16 << 20 }
    }
}

/// The JSON Schema of [`Settings`], as committed in `settings.schema.json` (pretty, with a final
/// newline).
pub fn schema_json() -> String {
    let schema = schemars::schema_for!(Settings);
    let mut text = serde_json::to_string_pretty(&schema).unwrap_or_default();
    text.push('\n');
    text
}

/// The [`Settings`] schema as a value, for looking up a key's allowed values.
pub(crate) fn schema_value() -> serde_json::Value {
    serde_json::to_value(schemars::schema_for!(Settings)).unwrap_or_default()
}
