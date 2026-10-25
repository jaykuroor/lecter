#!/usr/bin/env python3
"""Download the pinned PDFium build (D-084) and verify its SHA-256 before anything uses it (SEC-51).

  python3 spikes/pdfium/fetch_pdfium.py                 # the host target; prints the library path
  python3 spikes/pdfium/fetch_pdfium.py --all --report  # all five targets; sizes and computed SHA-256
  options: --target T  --dest DIR  --pins FILE  --offline

Exit codes: 0 ok, 1 or 2 usage, download or archive error, 3 checksum mismatch (the file is refused and deleted).
The archive is read into memory once (64 MiB cap), hashed, and the files are taken from that same buffer:
nothing reopens the archive by path after it is verified. An existing library on disk is kept only if it is
byte-identical to the verified archive's copy. Several processes may run this at once on one --dest
(parallel tests): writes go through a temp file, and a destination that another process already wrote
with identical bytes (and may hold open, as Windows does with a loaded DLL) is left alone.
"""
import argparse, hashlib, io, json, os, platform, sys, tarfile, tempfile, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DEST = HERE.parent.parent / "target" / "pdfium"
MAX_BYTES = 64 * 1024 * 1024  # largest pinned archive is ~7 MB; anything far bigger is not ours
ATTEMPTS, ATTEMPT_SECONDS, READ_TIMEOUT = 3, 90, 30
REPLACE_TRIES, REPLACE_PAUSE = 20, 0.1  # Windows: a reader holding the destination open blocks os.replace


class Mismatch(Exception):
    pass


class Stalled(Exception):
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


def read_capped(path):
    """The whole file, refusing anything over MAX_BYTES."""
    try:
        with open(path, "rb") as f:
            data = f.read(MAX_BYTES + 1)
    except OSError as e:
        raise SystemExit(f"fetch_pdfium: cannot read {path}: {e}")
    if len(data) > MAX_BYTES:
        raise SystemExit(f"fetch_pdfium: {path} is larger than {MAX_BYTES} bytes; refused")
    return data


def same_bytes(path, data):
    try:
        return path.is_file() and path.stat().st_size == len(data) and path.read_bytes() == data
    except OSError:
        return False


def install(tmp, dest, data):
    """Move the temp file `tmp` (holding `data`) onto `dest`. If `dest` already holds identical bytes, or
    another process put them there while the replace was blocked, discard `tmp` instead."""
    try:
        for _ in range(REPLACE_TRIES):
            if same_bytes(dest, data):
                return
            try:
                os.replace(tmp, dest)
                return
            except OSError as e:  # PermissionError on Windows while another process has dest open
                last = e
                time.sleep(REPLACE_PAUSE)
        if same_bytes(dest, data):
            return
        raise SystemExit(f"fetch_pdfium: cannot replace {dest} (held open by another process?): {last}")
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass


def write_file(dest, data):
    """Write `data` to `dest` unless it is already there byte for byte."""
    if same_bytes(dest, data):
        return
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=".part-")
        with os.fdopen(fd, "wb") as out:
            out.write(data)
    except OSError as e:
        raise SystemExit(f"fetch_pdfium: cannot write {dest}: {e}")
    install(tmp, dest, data)


def download_once(url):
    deadline = time.monotonic() + ATTEMPT_SECONDS
    buf = bytearray()
    with urllib.request.urlopen(url, timeout=READ_TIMEOUT) as resp:
        while chunk := resp.read(1 << 16):
            buf += chunk
            if len(buf) > MAX_BYTES:
                raise SystemExit(f"fetch_pdfium: {url} is larger than {MAX_BYTES} bytes; refused")
            if time.monotonic() > deadline:
                raise Stalled(f"{len(buf)} bytes after {ATTEMPT_SECONDS} s")
        expected = resp.headers.get("Content-Length")
        if expected is not None and expected.isdigit() and int(expected) != len(buf):
            raise Stalled(f"truncated: {len(buf)} of {expected} bytes")
    return bytes(buf)


def download(url):
    """The body of `url`, retrying a stalled or failed transfer (seen through the sandbox proxy)."""
    errors = []
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return download_once(url)
        except (Stalled, OSError, ValueError) as e:  # URLError, timeouts and resets are OSErrors
            errors.append(f"attempt {attempt}: {e}")
            print(f"fetch_pdfium: {url} {errors[-1]}; retrying", file=sys.stderr)
    raise SystemExit(f"fetch_pdfium: could not download {url}: {'; '.join(errors)}")


def verified_archive(pins, target, dest, offline):
    """(path, bytes, computed sha256) of the target's archive; raises Mismatch before anything uses it."""
    pin = pins["targets"][target]
    archive = dest / pins["tag"].replace("/", "-") / pin["asset"]
    if archive.exists():
        data = read_capped(archive)
    elif offline:
        raise SystemExit(f"fetch_pdfium: {archive} is missing and --offline was given")
    else:
        url = f"{pins['source']}/releases/download/{pins['tag']}/{pin['asset']}"
        print(f"fetch_pdfium: downloading {url}", file=sys.stderr)
        data = download(url)
    actual = hashlib.sha256(data).hexdigest()
    if actual != pin["sha256"]:
        try:
            archive.unlink(missing_ok=True)
            fate = "deleted"
        except OSError as e:
            fate = f"could not be deleted ({e})"
        raise Mismatch(f"fetch_pdfium: SHA-256 mismatch for {target} ({archive.name}): expected {pin['sha256']}, got {actual}; file {fate}, not used")
    if not same_bytes(archive, data):
        write_file(archive, data)  # cache the verified download
    return archive, data, actual


def wanted_members(data, archive_name, library):
    """The library, LICENSE and licenses/<file>, read from the verified bytes (never extracted by name)."""
    out = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            for m in tar:
                name = m.name.removeprefix("./")
                parts = name.split("/")
                keep = name in (library, "LICENSE") or (len(parts) == 2 and parts[0] == "licenses" and parts[1] not in ("", ".", ".."))
                if not keep:
                    continue
                if not m.isfile() or m.size > MAX_BYTES:
                    raise SystemExit(f"fetch_pdfium: {name} in {archive_name} is not a regular file under {MAX_BYTES} bytes")
                f = tar.extractfile(m)
                if f is None:
                    raise SystemExit(f"fetch_pdfium: cannot read {name} from {archive_name}")
                out[name] = f.read()
    except (tarfile.TarError, OSError, EOFError) as e:
        raise SystemExit(f"fetch_pdfium: {archive_name} is not a readable .tgz: {e}")
    for need in (library, "LICENSE"):
        if need not in out:
            raise SystemExit(f"fetch_pdfium: {archive_name} has no {need}")
    return out


def fetch(pins, target, dest, offline):
    archive, data, actual = verified_archive(pins, target, dest, offline)
    lib_name = pins["targets"][target]["library"]
    out_dir = archive.parent / target
    members = wanted_members(data, archive.name, lib_name)
    lib = out_dir / Path(lib_name).name
    write_file(lib, members.pop(lib_name))
    for name, body in members.items():
        write_file(out_dir / name, body)
    return len(data), actual, lib


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--target")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--report", action="store_true", help="print sizes and the SHA-256 computed from the bytes")
    ap.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    ap.add_argument("--pins", type=Path, default=HERE / "pins.json")
    ap.add_argument("--offline", action="store_true", help="never download; use only what is in --dest")
    a = ap.parse_args()
    try:
        pins = json.loads(a.pins.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"fetch_pdfium: cannot read pins {a.pins}: {e}")
    targets = list(pins["targets"]) if a.all else [a.target or host_target()]
    for t in targets:
        if t not in pins["targets"]:
            raise SystemExit(f"fetch_pdfium: unknown target {t}; pinned: {', '.join(pins['targets'])}")
    try:
        results = [(t, *fetch(pins, t, a.dest.resolve(), a.offline)) for t in targets]
    except Mismatch as e:
        print(e, file=sys.stderr)
        return 3
    for t, size, actual, lib in results:
        if a.report:
            print(f"{t}\t{pins['tag']}\tarchive {size} B\tlibrary {lib.name} {lib.stat().st_size} B\tsha256 {actual}")
        else:
            print(lib)
    return 0


if __name__ == "__main__":
    sys.exit(main())
