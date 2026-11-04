//! The precedence chain: per prompt > role file > course > global > built-in default
//! (`12-settings-theme-onboarding.md#settings`).

use serde_json::{Map, Value};

use super::global_only::loosens;
use super::keys::defaults;
use super::layer::{Layer, Source};
use super::schema::Settings;

/// A key's effective value and the level that set it.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    /// The value.
    pub value: Value,
    /// Where it came from.
    pub source: Source,
}

/// The layers in force, ready to answer "what is `key`, and who set it".
#[derive(Debug, Clone, Default)]
pub struct SettingsStack {
    /// Most specific first: prompt, role, course, global.
    layers: Vec<(Source, Layer)>,
    /// Course and role keys dropped because they loosen the global value (SEC-25).
    loosening: Vec<(Source, String)>,
}

impl SettingsStack {
    /// The chain from these layers. A course or role value that would loosen the global value
    /// (a higher budget, web search the global settings turn off, …) is dropped and listed in
    /// [`Self::loosening`].
    pub fn new(global: Layer, course: Option<Layer>, role: Option<Layer>, prompt: Option<Layer>) -> Self {
        let mut stack = Self { layers: Vec::with_capacity(4), loosening: Vec::new() };
        let global_value = |key: &str| global.get(key).or_else(|| defaults().get(key)).cloned().unwrap_or(Value::Null);
        for (source, layer) in [(Source::Prompt, prompt), (Source::Role, role), (Source::Course, course)] {
            let Some(mut layer) = layer else { continue };
            if source.is_course_level() {
                let loose: Vec<String> = layer
                    .keys()
                    .filter(|k| loosens(k, layer.get(k).unwrap_or(&Value::Null), &global_value(k)))
                    .map(str::to_owned)
                    .collect();
                for key in loose {
                    layer.remove(&key);
                    stack.loosening.push((source, key));
                }
            }
            stack.layers.push((source, layer));
        }
        stack.layers.push((Source::Global, global));
        stack
    }

    /// The effective value of `key` and its source; `None` for a key no setting has.
    pub fn get(&self, key: &str) -> Option<Resolved> {
        for (source, layer) in &self.layers {
            if let Some(value) = layer.get(key) {
                return Some(Resolved { value: value.clone(), source: *source });
            }
        }
        defaults().get(key).map(|value| Resolved { value: value.clone(), source: Source::Default })
    }

    /// Every setting's effective value, typed.
    pub fn settings(&self) -> Settings {
        let mut root = Value::Object(Map::new());
        for key in defaults().keys() {
            if let Some(resolved) = self.get(key) {
                insert_path(&mut root, key, resolved.value);
            }
        }
        // Each value was validated on its own, so the whole tree deserialises.
        serde_json::from_value(root).unwrap_or_default()
    }

    /// Course and role keys dropped because they loosened a global value.
    pub fn loosening(&self) -> &[(Source, String)] {
        &self.loosening
    }
}

/// Puts `value` at the dotted `key` inside the object `root`.
fn insert_path(root: &mut Value, key: &str, value: Value) {
    let mut node = root;
    let mut parts = key.split('.').peekable();
    while let Some(part) = parts.next() {
        let Value::Object(map) = node else { return };
        if parts.peek().is_none() {
            map.insert(part.to_owned(), value);
            return;
        }
        node = map.entry(part.to_owned()).or_insert_with(|| Value::Object(Map::new()));
    }
}
