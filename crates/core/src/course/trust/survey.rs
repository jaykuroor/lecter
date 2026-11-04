//! What the trust screen lists, and the fingerprint that asks again when it changes (SEC-25).
//!
//! The fingerprint covers the course's `AGENTS.md`, its role files (`.lecter/agents/*.md`),
//! everything under `.lecter/skills/`, and the `settings` object of `.lecter/course.jsonc`
//! (course details such as its name or colour don't count). Links are never followed out of the
//! course: an entry that resolves outside the root counts by its name only, so pointing it
//! somewhere else changes nothing, but adding, removing or re-pointing it inside does.

use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

use crate::course::{MAX_ENTRIES, within};
use crate::error::{Error, Result};
use crate::settings::{COURSE_FILE, Layer, Source, jsonc};

/// The most bytes of one file the fingerprint reads; past that, its length stands in for the rest.
const MAX_HASHED_BYTES: u64 = 16 * 1024 * 1024;

/// The most names one list on the screen shows; the last line then says how many more there are.
pub(super) const MAX_LISTED: usize = 200;

/// The course's AI files: listed for the screen, and their fingerprint.
#[derive(Debug, Clone, PartialEq, Eq)]
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
    /// blake3 of all of the above, in hex.
    pub fingerprint: String,
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
}

/// Lists and fingerprints the AI files of the canonical course root `root`.
fn ai_files(root: &Path) -> Result<Found> {
    let mut print = Print(blake3::Hasher::new());
    print.part("lecter-trust", b"1");
    let mut agents = Vec::new();
    if exists(&root.join("AGENTS.md")) {
        agents.push("AGENTS.md".to_owned());
        file(&mut print, root, "AGENTS.md")?;
    }
    let (mut roles, mut skills, mut overrides) = (Vec::new(), Vec::new(), Vec::new());
    match inside(root, ".lecter")? {
        Place::Missing => {}
        Place::Outside => print.part("outside", b".lecter"),
        Place::Inside(_) => {
            roles = role_files(&mut print, root)?;
            skills = skill_folders(&mut print, root)?;
            overrides = settings_overrides(&mut print, root);
        }
    }
    let fingerprint = print.0.finalize().to_hex().to_string();
    for list in [&mut roles, &mut skills, &mut overrides] {
        cap(list);
    }
    Ok(Found { sources: 0, agents, roles, skills, overrides, fingerprint })
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
fn inside(root: &Path, rel: &str) -> Result<Place> {
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

/// Adds the file at course-relative `rel`: its content when it is a regular file in the course,
/// otherwise only what it is.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn file(print: &mut Print, root: &Path, rel: &str) -> Result<()> {
    let real = match inside(root, rel)? {
        Place::Missing => {
            print.part("dangling", rel.as_bytes());
            return Ok(());
        }
        Place::Outside => {
            print.part("outside", rel.as_bytes());
            return Ok(());
        }
        Place::Inside(p) => p,
    };
    let io = |e: std::io::Error| Error::ReadFailed { path: rel.to_owned(), kind: e.kind() };
    if !std::fs::metadata(&real).map_err(io)?.is_file() {
        print.part("not-a-file", rel.as_bytes());
        return Ok(());
    }
    let f = std::fs::File::open(&real).map_err(io)?;
    let len = f.metadata().map_err(io)?.len();
    let mut content = blake3::Hasher::new();
    std::io::copy(&mut f.take(MAX_HASHED_BYTES), &mut content).map_err(io)?;
    print.part("file", rel.as_bytes());
    print.part("len", &len.to_le_bytes());
    print.part("content", content.finalize().as_bytes());
    Ok(())
}

/// The visible entries of the folder at course-relative `rel` (inside the course), sorted by name,
/// at most [`MAX_ENTRIES`]. Names that aren't Unicode are left out.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn entries(dir: &Path, rel: &'static str, hidden: bool) -> Result<Vec<(String, std::fs::FileType)>> {
    let io = |e: std::io::Error| Error::Io(e.kind());
    let mut out = Vec::new();
    for (seen, entry) in std::fs::read_dir(dir).map_err(io)?.enumerate() {
        if seen >= MAX_ENTRIES {
            return Err(Error::TooManyEntries { folder: rel, limit: MAX_ENTRIES });
        }
        let entry = entry.map_err(io)?;
        let Ok(name) = entry.file_name().into_string() else { continue };
        if name.starts_with('.') && !hidden {
            continue;
        }
        out.push((name, entry.file_type().map_err(io)?));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

/// The role files `.lecter/agents/*.md`, each added to the fingerprint.
fn role_files(print: &mut Print, root: &Path) -> Result<Vec<String>> {
    const DIR: &str = ".lecter/agents";
    let Place::Inside(dir) = inside(root, DIR)? else {
        if exists(&root.join(DIR)) {
            print.part("outside", DIR.as_bytes());
        }
        return Ok(Vec::new());
    };
    let mut roles = Vec::new();
    for (name, _) in entries(&dir, DIR, false)? {
        if Path::new(&name).extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) {
            let rel = format!("{DIR}/{name}");
            file(print, root, &rel)?;
            roles.push(rel);
        }
    }
    Ok(roles)
}

/// The skill folders `.lecter/skills/<name>`; every file below them is added to the fingerprint.
fn skill_folders(print: &mut Print, root: &Path) -> Result<Vec<String>> {
    const DIR: &str = ".lecter/skills";
    let Place::Inside(dir) = inside(root, DIR)? else {
        if exists(&root.join(DIR)) {
            print.part("outside", DIR.as_bytes());
        }
        return Ok(Vec::new());
    };
    let skills = entries(&dir, DIR, false)?.into_iter().map(|(name, _)| format!("{DIR}/{name}")).collect();
    walk_skills(print, root, dir, DIR)?;
    Ok(skills)
}

/// Adds every entry under `dir` (course-relative `rel`) at any depth, hidden ones too: a skill
/// may carry scripts. Links are added by name and target, never walked into, so the walk can't
/// loop; it stops with [`Error::TooManyEntries`] past [`MAX_ENTRIES`] entries in all.
fn walk_skills(print: &mut Print, root: &Path, dir: PathBuf, rel: &str) -> Result<()> {
    // Depth first, each folder's entries in name order. A stack, not recursion: no depth limit
    // to hide a deep file behind, and no stack to overflow.
    let mut stack = vec![(dir, rel.to_owned())];
    let mut seen = 0;
    while let Some((dir, rel)) = stack.pop() {
        let mut folders = Vec::new();
        for (name, kind) in entries(&dir, ".lecter/skills", true)? {
            seen += 1;
            if seen > MAX_ENTRIES {
                return Err(Error::TooManyEntries { folder: ".lecter/skills", limit: MAX_ENTRIES });
            }
            let child = format!("{rel}/{name}");
            if kind.is_dir() {
                print.part("dir", child.as_bytes());
                folders.push((dir.join(&name), child));
            } else if kind.is_symlink() {
                print.part("link", child.as_bytes());
                link_target(print, root, &child)?;
            } else {
                file(print, root, &child)?;
            }
        }
        stack.extend(folders.into_iter().rev());
    }
    Ok(())
}

/// Adds where the link at course-relative `rel` leads: a file's content, or a folder's
/// course-relative path (not walked, so a link can't loop).
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn link_target(print: &mut Print, root: &Path, rel: &str) -> Result<()> {
    match inside(root, rel)? {
        Place::Inside(p) if p.is_dir() => {
            let target = p.strip_prefix(root).map(|t| t.to_string_lossy().into_owned()).unwrap_or_default();
            print.part("to-dir", target.as_bytes());
            Ok(())
        }
        _ => file(print, root, rel),
    }
}

/// The dotted keys `.lecter/course.jsonc` sets under `settings`; the object itself (or why it
/// can't be read) goes into the fingerprint. Course details outside `settings` don't count.
fn settings_overrides(print: &mut Print, root: &Path) -> Vec<String> {
    let path = root.join(".lecter").join(COURSE_FILE);
    let read = jsonc::check_within(&path, Some(root)).and_then(|()| jsonc::read_text(&path));
    let text = match read {
        Ok(Some(text)) => text,
        Ok(None) => return Vec::new(),
        Err(e) => {
            print.part("course.jsonc-unusable", e.to_string().as_bytes());
            return Vec::new();
        }
    };
    let object = match jsonc::parse(&text).and_then(|v| jsonc::settings_object(v, Some("settings"))) {
        Ok(object) => object,
        Err(_) => {
            // Broken now, so nothing applies; fixing it changes the text and asks again.
            print.part("course.jsonc-broken", text.as_bytes());
            return Vec::new();
        }
    };
    print.part("settings", object.to_string().as_bytes());
    let layer = Layer::from_value(Source::Course, &object);
    let mut keys: Vec<String> = layer.keys().map(str::to_owned).collect();
    keys.extend(layer.ignored.iter().cloned());
    keys.extend(layer.unknown.iter().cloned());
    keys.extend(layer.invalid.iter().map(|(k, _)| k.clone()));
    keys.sort();
    keys.dedup();
    keys
}

/// The files in `sources/` and its subfolders at any depth, hidden ones left out. Links are
/// counted only when they lead to a file inside the course (links out are F-047's), and never
/// walked into. The count stops at [`MAX_ENTRIES`] entries looked at.
#[allow(clippy::disallowed_methods, reason = "a blocking function; async callers run it in spawn_blocking")]
fn count_sources(root: &Path) -> Result<u32> {
    let Place::Inside(dir) = inside(root, "sources")? else { return Ok(0) };
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
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let kind = entry.file_type().map_err(io)?;
            if kind.is_dir() {
                stack.push(entry.path());
            } else if kind.is_file()
                || (kind.is_symlink()
                    && std::fs::canonicalize(entry.path()).is_ok_and(|t| within(root, &t) && t.is_file()))
            {
                count += 1;
            }
        }
    }
    Ok(count)
}
