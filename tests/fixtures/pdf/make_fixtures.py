#!/usr/bin/env python3
"""Writes the synthetic PDF fixtures in this folder (F-019). Synthetic English text only.

  python3 tests/fixtures/pdf/make_fixtures.py          # rewrite the fixtures
  python3 tests/fixtures/pdf/make_fixtures.py --check  # exit 1 if a fixture differs from what this writes

text-two-pages.pdf: two US-letter pages of Helvetica text (a standard font, nothing embedded). Each line
is its own text object, drawn out of reading order on purpose (the bottom paragraph first, a
paragraph's second line before its first), so only the positions give the reading order.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# (font size, x, baseline y, text) in drawing order. Reading order is top to bottom.
PAGES = [
    [
        (16, 72, 560, "Heat flows from hot to cold."),
        (16, 72, 640, "of an isolated system never falls."),
        (28, 72, 720, "Entropy and heat"),
        (16, 72, 660, "The second law says that the entropy"),
    ],
    [
        (16, 72, 640, "Its entropy falls and the room gains more."),
        (16, 72, 660, "A cup of tea cools in a room."),
        (28, 72, 720, "Worked example"),
    ],
]


def pdf(pages):
    n = len(pages)
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n))
    font = 3 + 2 * n
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", f"<< /Type /Pages /Kids [{kids}] /Count {n} >>"]
    for i, lines in enumerate(pages):
        content = "\n".join(f"BT /F1 {size} Tf {x} {y} Td ({text}) Tj ET" for size, x, y, text in lines)
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4 + 2 * i} 0 R "
                       f"/Resources << /Font << /F1 {font} 0 R >> >> >>")
        objects.append(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream")
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects):
        offsets.append(len(out))
        out += f"{i + 1} 0 obj\n{body}\nendobj\n".encode("ascii")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")
    for off in offsets:
        out += f"{off:010} 00000 n \n".encode("ascii")
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    return bytes(out)


FIXTURES = {"text-two-pages.pdf": pdf(PAGES)}


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    for name, data in FIXTURES.items():
        path = HERE / name
        if check:
            if not path.exists() or path.read_bytes() != data:
                stale.append(name)
        else:
            path.write_bytes(data)
    if stale:
        print("stale fixtures (rerun without --check): " + ", ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
