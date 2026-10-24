#!/usr/bin/env python3
"""Writes the shell's window icons (icon.png, icon.ico) with the standard library only.

  python3 app/icons/make_icons.py

A rounded square in the `accent-bg` token with an `accent-fg` page on it (docs/design/tokens.json).
Installer icons in every size are packaging's job; this is the one icon Tauri needs to build.
"""
import json, struct, zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOKENS = HERE.parent.parent / "docs" / "design" / "tokens.json"
SIZE = 256


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def pixels(bg, fg):
    r, inset = SIZE * 0.2, SIZE * 0.06
    page = (SIZE * 0.3, SIZE * 0.2, SIZE * 0.7, SIZE * 0.8)
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            # distance outside the rounded square's corner arcs
            cx = min(max(x + 0.5, inset + r), SIZE - inset - r)
            cy = min(max(y + 0.5, inset + r), SIZE - inset - r)
            inside = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r
            if not inside:
                row += bytes((0, 0, 0, 0))
            elif page[0] <= x < page[2] and page[1] <= y < page[3]:
                row += bytes((*fg, 255))
            else:
                row += bytes((*bg, 255))
        rows.append(bytes(row))
    return rows


def png(rows):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + r for r in rows)
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def ico(png_bytes):
    # One PNG-compressed entry; width/height 0 means 256.
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png_bytes), 6 + 16)
    return header + entry + png_bytes


def main():
    colour = json.loads(TOKENS.read_text(encoding="utf-8"))["color"]
    data = png(pixels(hex_rgb(colour["accent-bg"]["light"]), hex_rgb(colour["accent-fg"]["light"])))
    (HERE / "icon.png").write_bytes(data)
    (HERE / "icon.ico").write_bytes(ico(data))


if __name__ == "__main__":
    main()
