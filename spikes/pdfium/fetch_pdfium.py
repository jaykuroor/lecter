#!/usr/bin/env python3
"""Download the pinned PDFium build (D-084) and verify its SHA-256 before anything uses it (SEC-51).

  python3 spikes/pdfium/fetch_pdfium.py                 # the host target; prints the library path
  python3 spikes/pdfium/fetch_pdfium.py --all --report  # all five targets; prints a size table
  options: --target T  --dest DIR  --pins FILE  --offline

Exit codes: 0 ok, 1 or 2 usage, download or archive error, 3 checksum mismatch (the file is refused and deleted).
The archive is hashed every run; the library is (re)extracted only from an archive that matched its pin,
and an existing library on disk is compared byte for byte with the verified archive's copy.
"""
import argparse, hashlib, json, os, platform, sys, tarfile, tempfile, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DEST = HERE.parent.parent / "target" / "pdfium"
MAX_BYTES = 64 * 1024 * 1024  # largest pinned archive is ~7 MB; anything far bigger is not ours
ATTEMPTS, ATTEMPT_SECONDS, READ_TIMEOUT = 3, 90, 30


class Mismatch(Exception):
    pass


def host_target():
    machine = platform.machine().lower()
    arm = machine in ("arm64", "aarch64")
    if sys.platform.startswith("linux"):
        return "linux-arm64" if arm else "linux-x64"
    if sys.platform == "darwin":
        return "macos-universal"
    if sys.platform in ("win32", "cygwin"):
        return "windows-arm64" if arm else "windows-x64"
    raise SystemExit(f"fetch_pdfium: no pinned PDFium for {sys.platform}/{machine}")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Stalled(Exception):
    pass


def download_once(url, dest):
    fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=".part-")
    deadline = time.monotonic() + ATTEMPT_SECONDS
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(url, timeout=READ_TIMEOUT) as resp:
            total = 0
            while chunk := resp.read(1 << 16):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise SystemExit(f"fetch_pdfium: {url} is larger than {MAX_BYTES} bytes; refused")
                if time.monotonic() > deadline:
                    raise Stalled(f"{total} bytes after {ATTEMPT_SECONDS} s")
                out.write(chunk)
            expected = resp.headers.get("Content-Length")
            if expected is not None and int(expected) != total:
                raise Stalled(f"truncated: {total} of {expected} bytes")
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def download(url, dest):
    """Fetch `url` to `dest`, retrying a stalled or failed transfer (seen through the sandbox proxy)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return download_once(url, dest)
        except (Stalled, OSError) as e:  # URLError, timeouts and resets are OSErrors
            errors.append(f"attempt {attempt}: {e}")
            print(f"fetch_pdfium: {url} {errors[-1]}; retrying", file=sys.stderr)
    raise SystemExit(f"fetch_pdfium: could not download {url}: {'; '.join(errors)}")


def verified_archive(pins, target, dest, offline):
    pin = pins["targets"][target]
    archive = dest / pins["tag"].replace("/", "-") / pin["asset"]
    if not archive.exists():
        if offline:
            raise SystemExit(f"fetch_pdfium: {archive} is missing and --offline was given")
        url = f"{pins['source']}/releases/download/{pins['tag']}/{pin['asset']}"
        print(f"fetch_pdfium: downloading {url}", file=sys.stderr)
        download(url, archive)
    actual = sha256_file(archive)
    if actual != pin["sha256"]:
        archive.unlink()
        raise Mismatch(f"fetch_pdfium: SHA-256 mismatch for {target} ({archive.name}): expected {pin['sha256']}, got {actual}; file deleted, not used")
    return archive


def wanted_members(archive, library):
    """The library, LICENSE and licenses/<file> from a verified archive, read into memory (never extracted by name)."""
    out = {}
    with tarfile.open(archive, "r:gz") as tar:
        for m in tar:
            name = m.name.removeprefix("./")
            parts = name.split("/")
            keep = name in (library, "LICENSE") or (len(parts) == 2 and parts[0] == "licenses" and parts[1] not in ("", ".", ".."))
            if not keep:
                continue
            if not m.isfile() or m.size > MAX_BYTES:
                raise SystemExit(f"fetch_pdfium: {name} in {archive.name} is not a regular file under {MAX_BYTES} bytes")
            f = tar.extractfile(m)
            if f is None:
                raise SystemExit(f"fetch_pdfium: cannot read {name} from {archive.name}")
            out[name] = f.read()
    for need in (library, "LICENSE"):
        if need not in out:
            raise SystemExit(f"fetch_pdfium: {archive.name} has no {need}")
    return out


def place(data, path):
    """Write `data` to `path` unless an identical file is already there (it may be loaded by another process)."""
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".part-")
    with os.fdopen(fd, "wb") as out:
        out.write(data)
    os.replace(tmp, path)


def fetch(pins, target, dest, offline):
    archive = verified_archive(pins, target, dest, offline)
    lib_name = pins["targets"][target]["library"]
    out_dir = archive.parent / target
    members = wanted_members(archive, lib_name)
    lib = out_dir / Path(lib_name).name
    place(members.pop(lib_name), lib)
    for name, data in members.items():
        place(data, out_dir / name)
    return archive, lib


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--target")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--report", action="store_true", help="print archive and library sizes")
    ap.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    ap.add_argument("--pins", type=Path, default=HERE / "pins.json")
    ap.add_argument("--offline", action="store_true", help="never download; use only what is in --dest")
    a = ap.parse_args()
    pins = json.loads(a.pins.read_text(encoding="utf-8"))
    targets = list(pins["targets"]) if a.all else [a.target or host_target()]
    for t in targets:
        if t not in pins["targets"]:
            raise SystemExit(f"fetch_pdfium: unknown target {t}; pinned: {', '.join(pins['targets'])}")
    try:
        results = [(t, *fetch(pins, t, a.dest.resolve(), a.offline)) for t in targets]
    except Mismatch as e:
        print(e, file=sys.stderr)
        return 3
    for t, archive, lib in results:
        if a.report:
            print(f"{t}\t{pins['tag']}\tarchive {archive.stat().st_size} B\tlibrary {lib.name} {lib.stat().st_size} B\tsha256 {pins['targets'][t]['sha256']} OK")
        else:
            print(lib)
    return 0


if __name__ == "__main__":
    sys.exit(main())
