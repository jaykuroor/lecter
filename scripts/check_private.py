#!/usr/bin/env python3
"""Fail if the private test corpus (tests/corpus/private) leak into anything git tracks.

  python3 scripts/check_private.py [--root DIR]

Checks:
  1. git tracks nothing at or under tests/corpus/private (a symlink there counts too);
  2. no tracked symlink points into a private corpus;
  3. no tracked PDF, PPTX, KEY or ODP exists outside tests/fixtures/ and tests/corpus/public/;
  4. no tracked file has the same SHA-256 as a private file;
  5. no tracked text file names a private file (stems of 6+ characters);
  6. no tracked text file contains a verbatim run of about 200+ characters of text from a
     private file (whitespace, case and punctuation ignored).
Checks 4-6 need the private folder; without it (CI) they have nothing to compare against.
Check 6 extracts PDF text with `pdftotext` (poppler-utils) once and caches it in
tests/corpus/private/.cache/ (ignored with the folder). Without pdftotext it still compares
the folder's text files (gold Markdown, snapshots) and prints a note.
Fingerprints: winnowed 48-character k-grams of the normalised text, then each shared
fingerprint is extended in both texts to measure the real run. Cheap and exact.
"""
import argparse, hashlib, re, shutil, subprocess, sys
from pathlib import Path

PRIVATE_REL = "tests/corpus/private"
DOCS = {".pdf", ".pptx", ".ppt", ".key", ".odp"}
ALLOWED_DOC_DIRS = ("tests/fixtures/", "tests/corpus/public/")
TEXT_EXT = {".md", ".json", ".jsonl", ".rs", ".ts", ".tsx", ".js", ".txt", ".toml", ".yml", ".yaml",
            ".snap", ".html", ".css", ".csv", ".tex", ".py", ".sh"}
PRIVATE_TEXT_EXT = {".md", ".txt", ".snap", ".json", ".jsonl", ".tex", ".csv"}
K = 48          # k-gram length on normalised text (letters and digits only)
W = 64          # winnowing window: any shared run of K + W - 1 = 111+ normalised chars is found
MIN_RUN = 160   # normalised characters, about 200 characters of ordinary prose


def is_private(path: str) -> bool:
    return path == PRIVATE_REL or path.startswith(PRIVATE_REL + "/")


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)


def tracked(root):
    """Tracked paths (index), plus (path, blob) for every tracked symlink."""
    out = git(root, "ls-files", "-z", "-s")
    files, links = [], []
    if out.returncode != 0:
        return files, links
    for rec in out.stdout.split("\0"):
        if not rec:
            continue
        meta, path = rec.split("\t", 1)
        mode, obj = meta.split()[:2]
        files.append(path)
        if mode == "120000":
            links.append((path, obj))
    return files, links


def normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _h(s: str) -> int:
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


def winnow(norm: str):
    """(hash, position) fingerprints: the minimum k-gram hash of every window of W k-grams."""
    if len(norm) < K:
        return []
    hashes = [_h(norm[i:i + K]) for i in range(len(norm) - K + 1)]
    out, last = [], None
    for start in range(0, max(1, len(hashes) - W + 1)):
        window = hashes[start:start + W]
        j = min(range(len(window)), key=lambda x: (window[x], -x))
        pick = (window[j], start + j)
        if pick != last:
            out.append(pick)
            last = pick
    return out


def pdf_text(path: Path, cache: Path):
    if not shutil.which("pdftotext"):
        return None
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    hit = cache / f"{sha}.txt"
    if not hit.exists():
        cache.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(["pdftotext", "-q", "-enc", "UTF-8", str(path), "-"], capture_output=True)
        hit.write_bytes(r.stdout if r.returncode == 0 else b"")
    return hit.read_text(encoding="utf-8", errors="ignore")


def private_texts(private: Path):
    """Normalised text of every private file we can read. Returns (texts, note)."""
    texts, note = [], ""
    cache = private / ".cache" / "text"
    for p in sorted(private.rglob("*")):
        if not p.is_file() or ".cache" in p.relative_to(private).parts:
            continue
        suf = p.suffix.lower()
        if suf == ".pdf":
            t = pdf_text(p, cache)
            if t is None:
                note = "note: install pdftotext (package poppler-utils) so PDF text is compared too"
                continue
        elif suf in PRIVATE_TEXT_EXT and p.stat().st_size < 20_000_000:
            t = p.read_text(encoding="utf-8", errors="ignore")
        else:
            continue
        n = normalise(t)
        if len(n) >= MIN_RUN:
            texts.append(n)
    return texts, note


def longest_shared_run(norm: str, private_norms, index):
    """Length of the longest run shared with a private text, found from shared fingerprints."""
    best = 0
    for h, pos in winnow(norm):
        for doc, ppos in index.get(h, ()):
            p = private_norms[doc]
            a, b = pos, ppos
            while a > 0 and b > 0 and norm[a - 1] == p[b - 1]:
                a, b = a - 1, b - 1
            e1, e2 = pos, ppos
            while e1 < len(norm) and e2 < len(p) and norm[e1] == p[e2]:
                e1, e2 = e1 + 1, e2 + 1
            best = max(best, e1 - a)
            if best >= MIN_RUN:
                return best
    return best


def check(root: Path):
    private = root / PRIVATE_REL
    files, links = tracked(root)
    problems = [f"tracked private path: {p}" for p in files if is_private(p)]
    for path, obj in links:
        target = git(root, "cat-file", "-p", obj).stdout
        if "corpus/private" in target and not is_private(path):
            problems.append(f"tracked symlink into the private corpus: {path}")
    problems += [f"document outside fixtures: {p}" for p in files
                 if Path(p).suffix.lower() in DOCS and not p.startswith(ALLOWED_DOC_DIRS)]
    note = ""
    if private.is_dir():
        priv = [p for p in private.rglob("*") if p.is_file() and ".cache" not in p.relative_to(private).parts]
        hashes = {hashlib.sha256(p.read_bytes()).hexdigest() for p in priv if p.suffix.lower() in DOCS}
        stems = {p.stem.lower() for p in priv if p.suffix.lower() in DOCS and len(p.stem) >= 6}
        texts, note = private_texts(private)
        index = {}
        for d, t in enumerate(texts):
            for h, pos in winnow(t):
                index.setdefault(h, []).append((d, pos))
        for f in files:
            fp = root / f
            if is_private(f) or fp.is_symlink() or not fp.is_file() or fp.stat().st_size > 50_000_000:
                continue
            data = fp.read_bytes()
            if hashlib.sha256(data).hexdigest() in hashes:
                problems.append(f"copy of a private file: {f}")
                continue
            if fp.suffix.lower() not in TEXT_EXT or len(data) > 5_000_000:
                continue
            text = data.decode("utf-8", "ignore")
            low = text.lower()
            if any(s in low for s in stems):
                problems.append(f"{f} names a private file (use its manifest id)")
            if index:
                run = longest_shared_run(normalise(text), texts, index)
                if run >= MIN_RUN:
                    problems.append(f"{f} contains a {run}+ character run copied from a private file")
    return problems, note


def main(argv=None):
    ap = argparse.ArgumentParser(description="Private-corpus leak check")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    args = ap.parse_args(argv)
    problems, note = check(Path(args.root).resolve())
    for p in problems:
        print(p)
    if note:
        print(note)
    print("PRIVATE OK" if not problems else f"{len(problems)} private-corpus problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
