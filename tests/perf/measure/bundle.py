"""ui_main_chunk_kb_gz (14-quality.md#performance-budgets): the UI's JavaScript after `vite build`,
gzipped. Builds ui/ (`pnpm -C ui run build`), checks that ui/dist/index.html loads one entry
module, and counts every JavaScript file under ui/dist: the entry and each chunk it can load, the
lazy ones too (the editor chunk is loaded right after the first paint, F-179, so it is part of
what every launch downloads and parses). Each file is gzipped on its own at zlib's default level 6
(what Vite's own size report uses) and the sizes are summed. KB = 1,000 bytes, as Vite prints it.
Prints one JSON line (tests/perf/harness.py)."""

import json
import re
import shutil
import subprocess
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DIST = ROOT / "ui" / "dist"


def main_chunk(dist: Path) -> Path:
    """The entry module of dist/index.html (`<script type="module" src="/assets/index-….js">`)."""
    html = (dist / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r"<script\b[^>]*\btype=\"module\"[^>]*\bsrc=\"([^\"]+)\"", html)
    if len(scripts) != 1:
        raise RuntimeError(f"expected one entry module in {dist / 'index.html'}, found {scripts}")
    chunk = (dist / scripts[0].lstrip("/")).resolve()
    if dist.resolve() not in chunk.parents or not chunk.is_file():
        raise RuntimeError(f"entry module {scripts[0]} is not a file under {dist}")
    return chunk


def all_js(dist: Path) -> list[Path]:
    """Every JavaScript file the build wrote, the entry first."""
    entry = main_chunk(dist)
    rest = sorted(p.resolve() for p in dist.rglob("*") if p.suffix in (".js", ".mjs") and p.is_file())
    return [entry] + [p for p in rest if p != entry]


def gzipped_kb(path: Path) -> float:
    c = zlib.compressobj(6, zlib.DEFLATED, 31)  # wbits 31: a gzip stream
    data = c.compress(path.read_bytes()) + c.flush()
    return len(data) / 1000


def measured(dist: Path) -> tuple[float, str]:
    """The budget's number (KB gzip, summed) and a per-file breakdown, biggest first."""
    files = [(p, gzipped_kb(p)) for p in all_js(dist)]
    total = sum(kb for _, kb in files)
    raw = sum(p.stat().st_size for p, _ in files) / 1000
    parts = ", ".join(f"{p.name} {kb:.2f}" for p, kb in sorted(files, key=lambda f: -f[1]))
    return total, f"{len(files)} JS files, {raw:.1f} KB raw, {total:.2f} KB gzip -6 (entry {files[0][0].name}): {parts}"


def main() -> int:
    ids = sys.argv[1:] or ["ui_main_chunk_kb_gz"]
    build = subprocess.run([shutil.which("pnpm") or "pnpm", "--silent", "-C", "ui", "run", "build"], cwd=ROOT, stdout=sys.stderr, stderr=sys.stderr)
    for bid in ids:
        if build.returncode != 0:
            print(json.dumps({"id": bid, "error": f"pnpm -C ui run build exited {build.returncode}"}))
            continue
        try:
            kb, detail = measured(DIST)
        except (OSError, RuntimeError) as e:
            print(json.dumps({"id": bid, "error": str(e)}))
            continue
        print(json.dumps({"id": bid, "value": round(kb, 2), "detail": detail}))
    return 0 if build.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
