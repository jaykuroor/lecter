"""ui_main_chunk_kb_gz (14-quality.md#performance-budgets): the main UI chunk after `vite build`,
gzipped. Builds ui/ (`pnpm -C ui run build`), takes the entry module that ui/dist/index.html loads,
and gzips it at zlib's default level 6 (what Vite's own size report uses). KB = 1,000 bytes, as
Vite prints it. Prints one JSON line (tests/perf/harness.py)."""

import json
import re
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


def gzipped_kb(path: Path) -> float:
    c = zlib.compressobj(6, zlib.DEFLATED, 31)  # wbits 31: a gzip stream
    data = c.compress(path.read_bytes()) + c.flush()
    return len(data) / 1000


def main() -> int:
    ids = sys.argv[1:] or ["ui_main_chunk_kb_gz"]
    build = subprocess.run(["pnpm", "--silent", "-C", "ui", "run", "build"], cwd=ROOT, stdout=sys.stderr, stderr=sys.stderr)
    for bid in ids:
        if build.returncode != 0:
            print(json.dumps({"id": bid, "error": f"pnpm -C ui run build exited {build.returncode}"}))
            continue
        try:
            chunk = main_chunk(DIST)
            kb = gzipped_kb(chunk)
        except (OSError, RuntimeError) as e:
            print(json.dumps({"id": bid, "error": str(e)}))
            continue
        raw = chunk.stat().st_size / 1000
        print(json.dumps({"id": bid, "value": round(kb, 2), "detail": f"{chunk.name}: {raw:.1f} KB raw, {kb:.2f} KB gzip -6"}))
    return 0 if build.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
