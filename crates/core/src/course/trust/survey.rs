//! What the trust screen lists, and the fingerprint that asks again when it changes (SEC-25).
//!
//! The fingerprint covers the course's `AGENTS.md`, its role files (`.lecter/agents/*.md`),
//! everything under `.lecter/skills/` (and inside the folders its links lead to in the course),
//! the `settings` object of `.lecter/course.jsonc` (course details such as its name or colour
//! don't count), and each link in `slides/` that leaves the course with where it leads (D-167), so
//! adding or re-pointing one asks again and the AI reaches only links the screen listed. A link's
//! target is resolved, never read. Links are never followed out of the course: an entry that resolves outside the
//! root counts by its name only, so pointing it somewhere else changes nothing, but adding,
//! removing or re-pointing it inside does. Names are hashed by their bytes, Unicode or not.
//!
//! A survey that can't see everything fails instead of guessing: more than [`MAX_ENTRIES`]
//! entries under `.lecter/skills/`, an AI file over [`MAX_HASHED_BYTES`], or a folder the OS
//! won't let Lecter read. Such a course can't be trusted (`TrustScreen::blocked`).

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

use crate::course::{MAX_ENTRIES, hidden, links_out, plain, within};
use crate::error::{Error, Result};
use crate::settings::{COURSE_FILE, Layer, Source, jsonc};

/// The largest AI file the fingerprint reads, whole; a larger one blocks trust.
pub(super) const MAX_HASHED_BYTES: u64 = 16 * 1024 * 1024;

/// The most names one list on the screen shows; the last line then says how many more there are.
pub(super) const MAX_LISTED: usize = 200;

/// The folder the skills walk reports in its errors.
const SKILLS: &str = ".lecter/skills";

/// The course's AI files: listed for the screen, and their fingerprint.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Found {
    /// Files in `sources/` and below.
    pub sources: u32,
    /// `AGENTS.md`, if present.
    pub agents: Vec<String>,
    /// `.lecter/agents/<role>.md`.
    pub roles: Vec<String>,
    /// `.lecter/skills/<name>`.
    pub skills: Vec<String>,
    /// Dotted settings keys of `course.jsonc`.
    pub overrides: Vec<String>,
    /// The links in `slides/` that leave the course, each as `slides/<name> → <target>`.
    pub links: Vec<String>,
    /// blake3 of all of the above, in hex.
    pub fingerprint: String,
    /// blake3 of all of it but course.jsonc's `settings`, in hex: what Lecter's own settings
    /// write must leave as it was.
    pub rest: String,
    /// course.jsonc's `settings` object (an empty one when there is no file or no `settings`);
    /// `None` when the file can't be used.
    pub settings: Option<serde_json::Value>,
}

/// Everything the screen shows about the folder `root` (any path to it).
pub(super) fn survey(root: &Path) -> Result<Found> {
    let root = canonical(root)?;
    let mut found = ai_files(&root)?;
    found.sources = count_sources(&root)?;
    Ok(found)
}

/// The fingerprint of the AI files of the folder `root` (any path to it).
pub(super) fn fingerprint(root: &Path) -> Result<String> {
    ai_files(&canonical(root)?).map(|f| f.fingerprint)
}

#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn canonical(root: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(root).map_err(|e| Error::Io(e.kind()))
}

/// Feeds tagged, length-prefixed parts into one hash, so no two inputs share a stream.
struct Print(blake3::Hasher);

impl Print {
    fn part(&mut self, tag: &str, bytes: &[u8]) {
        self.0.update(&(tag.len() as u64).to_le_bytes());
        self.0.update(tag.as_bytes());
        self.0.update(&(bytes.len() as u64).to_le_bytes());
        self.0.update(bytes);
    }

    /// A part naming the course-relative path `rel`, by its bytes.
    fn path(&mut self, tag: &str, rel: &OsStr) {
        self.part(tag, rel.as_encoded_bytes());
    }
}

/// `rel/name`, with `/` on every OS.
fn child(rel: &OsStr, name: &OsStr) -> OsString {
    let mut c = rel.to_owned();
    c.push("/");
    c.push(name);
    c
}

/// A course-relative path as the screen shows it.
fn shown(rel: &OsStr) -> String {
    rel.to_string_lossy().into_owned()
}

/// Lists and fingerprints the AI files of the canonical course root `root`.
fn ai_files(root: &Path) -> Result<Found> {
    let mut print = Print(blake3::Hasher::new());
    print.part("lecter-trust", b"2");
    let mut agents = Vec::new();
    if exists(&root.join("AGENTS.md")) {
        agents.push("AGENTS.md".to_owned());
        file(&mut print, root, OsStr::new("AGENTS.md"))?;
    }
    let (mut roles, mut skills) = (Vec::new(), Vec::new());
    let mut seen = Seen { overrides: Vec::new(), part: None, object: Some(empty()) };
    match inside(root, OsStr::new(".lecter"))? {
        Place::Missing => {}
        Place::Outside => print.part("outside", b".lecter"),
        Place::Inside(_) => {
            roles = role_files(&mut print, root)?;
            skills = skill_folders(&mut print, root)?;
            seen = settings_overrides(root);
        }
    }
    let mut links = slide_links(&mut print, root)?;
    // The settings part goes in last, so the hash before it is everything else.
    let rest = print.0.clone().finalize().to_hex().to_string();
    if let Some((tag, bytes)) = &seen.part {
        print.part(tag, bytes);
    }
    let fingerprint = print.0.finalize().to_hex().to_string();
    let mut overrides = seen.overrides;
    for list in [&mut roles, &mut skills, &mut overrides, &mut links] {
        cap(list);
    }
    Ok(Found { sources: 0, agents, roles, skills, overrides, links, fingerprint, rest, settings: seen.object })
}

/// The links in `slides/` that leave the course, as the screen shows them: `slides/<name> →
/// <target>`, and ` (hidden, never read)` after one that leads to something hidden. Each is added
/// to the fingerprint with its target; a course without any adds nothing, so its fingerprint is
/// the one it had before links out were allowed.
fn slide_links(print: &mut Print, root: &Path) -> Result<Vec<String>> {
    let mut shown = Vec::new();
    for link in links_out(root)? {
        let target = plain(&link.target.to_string_lossy());
        print.part("slide-link", link.path.as_bytes());
        print.path("to", link.target.as_os_str());
        let note = if link.listed { "" } else { " (hidden, never read)" };
        shown.push(format!("{} → {target}{note}", link.path));
    }
    Ok(shown)
}

/// Keeps a screen list short: past [`MAX_LISTED`] names, one line says how many more.
fn cap(list: &mut Vec<String>) {
    if list.len() > MAX_LISTED {
        let more = list.len() - (MAX_LISTED - 1);
        list.truncate(MAX_LISTED - 1);
        list.push(format!("… and {more} more"));
    }
}

/// Where a course-relative path leads once links are resolved.
enum Place {
    Missing,
    Outside,
    Inside(PathBuf),
}

/// Resolves `rel` under the canonical `root`. A dangling link is missing.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn inside(root: &Path, rel: &OsStr) -> Result<Place> {
    match std::fs::canonicalize(root.join(rel)) {
        Ok(p) if within(root, &p) => Ok(Place::Inside(p)),
        Ok(_) => Ok(Place::Outside),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(Place::Missing),
        Err(e) => Err(Error::Io(e.kind())),
    }
}

/// Whether anything (a link included, even a dangling one) sits at `path`.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

/// Adds the file at course-relative `rel`: its whole content when it is a regular file in the
/// course, otherwise only what it is. A file over [`MAX_HASHED_BYTES`] fails the survey.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn file(print: &mut Print, root: &Path, rel: &OsStr) -> Result<()> {
    let real = match inside(root, rel)? {
        Place::Missing => {
            print.path("dangling", rel);
            return Ok(());
        }
        Place::Outside => {
            print.path("outside", rel);
            return Ok(());
        }
        Place::Inside(p) => p,
    };
    let io = |e: std::io::Error| Error::ReadFailed { path: shown(rel), kind: e.kind() };
    if !std::fs::metadata(&real).map_err(io)?.is_file() {
        print.path("not-a-file", rel);
        return Ok(());
    }
    let f = std::fs::File::open(&real).map_err(io)?;
    let mut content = blake3::Hasher::new();
    // One byte past the limit tells a file that is too large, even one still growing.
    let read = std::io::copy(&mut f.take(MAX_HASHED_BYTES + 1), &mut content).map_err(io)?;
    if read > MAX_HASHED_BYTES {
        return Err(Error::AiFileTooLarge { path: shown(rel), limit: MAX_HASHED_BYTES });
    }
    print.path("file", rel);
    print.part("len", &read.to_le_bytes());
    print.part("content", content.finalize().as_bytes());
    Ok(())
}

/// The visible entries of the folder `dir` (`folder` names it in errors), sorted by name's bytes,
/// at most [`MAX_ENTRIES`]. Hidden ones only when `hidden`.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn entries(dir: &Path, folder: &'static str, hidden: bool) -> Result<Vec<(OsString, std::fs::FileType)>> {
    let io = |e: std::io::Error| Error::Io(e.kind());
    let mut out = Vec::new();
    for (seen, entry) in std::fs::read_dir(dir).map_err(io)?.enumerate() {
        if seen >= MAX_ENTRIES {
            return Err(Error::TooManyEntries { folder, limit: MAX_ENTRIES });
        }
        let entry = entry.map_err(io)?;
        let name = entry.file_name();
        if name.as_encoded_bytes().starts_with(b".") && !hidden {
            continue;
        }
        out.push((name, entry.file_type().map_err(io)?));
    }
    out.sort_by(|a, b| a.0.as_encoded_bytes().cmp(b.0.as_encoded_bytes()));
    Ok(out)
}

/// The role files `.lecter/agents/*.md`, each added to the fingerprint.
fn role_files(print: &mut Print, root: &Path) -> Result<Vec<String>> {
    const DIR: &str = ".lecter/agents";
    let Place::Inside(dir) = inside(root, OsStr::new(DIR))? else {
        if exists(&root.join(DIR)) {
            print.part("outside", DIR.as_bytes());
        }
        return Ok(Vec::new());
    };
    let mut roles = Vec::new();
    for (name, _) in entries(&dir, DIR, false)? {
        if Path::new(&name).extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) {
            let rel = child(OsStr::new(DIR), &name);
            file(print, root, &rel)?;
            roles.push(shown(&rel));
        }
    }
    Ok(roles)
}

/// The skill folders `.lecter/skills/<name>`; every file below them is added to the fingerprint.
fn skill_folders(print: &mut Print, root: &Path) -> Result<Vec<String>> {
    let Place::Inside(dir) = inside(root, OsStr::new(SKILLS))? else {
        if exists(&root.join(SKILLS)) {
            print.part("outside", SKILLS.as_bytes());
        }
        return Ok(Vec::new());
    };
    let skills =
        entries(&dir, SKILLS, false)?.into_iter().map(|(name, _)| shown(&child(OsStr::new(SKILLS), &name))).collect();
    walk_skills(print, root, dir)?;
    Ok(skills)
}

/// Adds every entry under the skills folder `dir` at any depth, hidden ones too: a skill may carry
/// scripts. A link is added by name and by what it leads to in the course: a file's content, or a
/// folder's path and everything in it, walked once however many links lead there (so links can't
/// loop). More than [`MAX_ENTRIES`] entries in all fail with [`Error::TooManyEntries`].
fn walk_skills(print: &mut Print, root: &Path, dir: PathBuf) -> Result<()> {
    // Depth first, each folder's entries in name order. A stack, not recursion: no depth limit
    // to hide a deep file behind, and no stack to overflow.
    let mut walked = HashSet::from([dir.clone()]);
    let mut stack = vec![(dir, OsString::from(SKILLS))];
    let mut seen = 0;
    while let Some((dir, rel)) = stack.pop() {
        let mut folders = Vec::new();
        for (name, kind) in entries(&dir, SKILLS, true)? {
            seen += 1;
            if seen > MAX_ENTRIES {
                return Err(Error::TooManyEntries { folder: SKILLS, limit: MAX_ENTRIES });
            }
            let at = child(&rel, &name);
            if kind.is_dir() {
                print.path("dir", &at);
                let real = dir.join(&name);
                if walked.insert(real.clone()) {
                    folders.push((real, at));
                }
            } else if kind.is_symlink() {
                print.path("link", &at);
                match inside(root, &at)? {
                    Place::Inside(target) if target.is_dir() => {
                        let to = target.strip_prefix(root).unwrap_or(&target).as_os_str().to_owned();
                        print.path("to-dir", &to);
                        if walked.insert(target.clone()) {
                            folders.push((target, at));
                        }
                    }
                    _ => file(print, root, &at)?,
                }
            } else {
                file(print, root, &at)?;
            }
        }
        stack.extend(folders.into_iter().rev());
    }
    Ok(())
}

/// What [`settings_overrides`] saw in course.jsonc.
struct Seen {
    /// The dotted keys it sets under `settings`.
    overrides: Vec<String>,
    /// The fingerprint's part for it, if any: the object, or why the file can't be used.
    part: Option<(&'static str, Vec<u8>)>,
    /// The `settings` object; `None` when the file can't be used.
    object: Option<serde_json::Value>,
}

/// An empty JSON object.
fn empty() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

/// The dotted keys `.lecter/course.jsonc` sets under `settings`; the object itself (or why it
/// can't be read) goes into the fingerprint. Course details outside `settings` don't count.
fn settings_overrides(root: &Path) -> Seen {
    let path = root.join(".lecter").join(COURSE_FILE);
    let read = jsonc::check_within(&path, Some(root)).and_then(|()| jsonc::read_text(&path));
    let text = match read {
        Ok(Some(text)) => text,
        Ok(None) => return Seen { overrides: Vec::new(), part: None, object: Some(empty()) },
        Err(e) => {
            let part = Some(("course.jsonc-unusable", e.to_string().into_bytes()));
            return Seen { overrides: Vec::new(), part, object: None };
        }
    };
    let object = match jsonc::parse(&text).and_then(|v| jsonc::settings_object(v, Some("settings"))) {
        Ok(object) => object,
        Err(_) => {
            // Broken now, so nothing applies; fixing it changes the text and asks again.
            let part = Some(("course.jsonc-broken", text.into_bytes()));
            return Seen { overrides: Vec::new(), part, object: None };
        }
    };
    // No overrides read the same as no file, so writing the course details into a new
    // `course.jsonc` (F-034) doesn't ask the trust question again.
    let part = object.as_object().is_some_and(|o| !o.is_empty()).then(|| ("settings", object.to_string().into_bytes()));
    let layer = Layer::from_value(Source::Course, &object);
    let mut keys: Vec<String> = layer.keys().map(str::to_owned).collect();
    keys.extend(layer.ignored.iter().cloned());
    keys.extend(layer.unknown.iter().cloned());
    keys.extend(layer.invalid.iter().map(|(k, _)| k.clone()));
    keys.sort();
    keys.dedup();
    Seen { overrides: keys, part, object: Some(object) }
}

/// The AI files of the folder `root` (any path to it), with what Lecter's own settings write
/// compares: the fingerprint without `settings`, and the `settings` object.
pub(super) fn ai(root: &Path) -> Result<Found> {
    ai_files(&canonical(root)?)
}

/// The files in `sources/` and its subfolders at any depth, hidden ones left out. Links are
/// counted only when they lead to a file inside the course that isn't hidden (only `slides/` links
/// may leave it, D-167), and never walked into. The count stops at [`MAX_ENTRIES`] entries looked at.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn count_sources(root: &Path) -> Result<u32> {
    let Place::Inside(dir) = inside(root, OsStr::new("sources"))? else { return Ok(0) };
    if !dir.is_dir() {
        return Ok(0);
    }
    let io = |e: std::io::Error| Error::Io(e.kind());
    let (mut stack, mut seen, mut count) = (vec![dir], 0, 0);
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).map_err(io)? {
            seen += 1;
            if seen > MAX_ENTRIES {
                return Ok(count);
            }
            let entry = entry.map_err(io)?;
            if entry.file_name().as_encoded_bytes().starts_with(b".") {
                continue;
            }
            let kind = entry.file_type().map_err(io)?;
            if kind.is_dir() {
                stack.push(entry.path());
            } else if kind.is_file()
                || (kind.is_symlink()
                    && std::fs::canonicalize(entry.path())
                        .is_ok_and(|t| within(root, &t) && !hidden(root, &t) && t.is_file()))
            {
                count += 1;
            }
        }
    }
    Ok(count)
}
