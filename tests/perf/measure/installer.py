"""installer_mb.<format> (14-quality.md#performance-budgets): the size of each release-profile
bundle that `tauri build` left in target/release/bundle/ (or $LECTER_BUNDLE_DIR). These budgets run
only in the nightly job (`budgets.sh --nightly`), after the release build. MB = 10^6 bytes.
A missing bundle is an error, not a pass. Prints one JSON line per id."""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# Format -> (folder under bundle/, file suffix) as Tauri 2 names them.
FORMATS = {
    "deb": ("deb", ".deb"),
    "rpm": ("rpm", ".rpm"),
    "dmg": ("dmg", ".dmg"),
    "exe": ("nsis", ".exe"),
    "appimage": ("appimage", ".AppImage"),
}


def bundle_size_mb(bundle: Path, fmt: str) -> tuple[float, str]:
    folder, suffix = FORMATS[fmt]
    files = sorted(p for p in (bundle / folder).glob(f"*{suffix}") if p.is_file())
    if len(files) != 1:
        raise FileNotFoundError(f"expected one *{suffix} in {bundle / folder}, found {len(files)}")
    return files[0].stat().st_size / 1_000_000, files[0].name


def main() -> int:
    bundle = Path(os.environ.get("LECTER_BUNDLE_DIR") or ROOT / "target" / "release" / "bundle")
    failed = False
    for bid in sys.argv[1:]:
        fmt = bid.removeprefix("installer_mb.")
        try:
            if fmt not in FORMATS:
                raise KeyError(f"unknown installer format {fmt!r}")
            mb, name = bundle_size_mb(bundle, fmt)
            print(json.dumps({"id": bid, "value": round(mb, 2), "detail": name}))
        except (OSError, KeyError) as e:
            failed = True
            print(json.dumps({"id": bid, "error": str(e)}))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
