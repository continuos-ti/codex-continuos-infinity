#!/usr/bin/env python3
"""Render the Codex Continuos Infinity launcher icons.

Requires Pillow. All geometric artwork is generated without bundled fonts.
"""
from pathlib import Path
from math import cos, pi, sin
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "launcher" / "assets"
SIZE = 1024


def render() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((40, 40, SIZE - 40, SIZE - 40), radius=235, fill=(13, 24, 53, 255))
    for ring in range(10):
        fade = max(12, 120 - ring * 11)
        draw.rounded_rectangle(
            (43 + ring, 43 + ring, SIZE - 43 - ring, SIZE - 43 - ring),
            radius=232 - ring,
            outline=(50, 198, 244, fade),
            width=2,
        )

    def point(angle: float) -> tuple[int, int]:
        denominator = 1 + cos(angle) ** 2
        x = 334 * sin(angle) / denominator
        y = 245 * sin(angle) * cos(angle) / denominator
        return round(SIZE / 2 + x), round(SIZE / 2 + y)

    points = [point(2 * pi * idx / 1400) for idx in range(1401)]
    draw.line(points, fill=(36, 53, 107, 255), width=101, joint="curve")
    draw.line(points, fill=(55, 88, 169, 255), width=84, joint="curve")
    for idx in range(len(points) - 1):
        ratio = idx / (len(points) - 1)
        blend = (sin(ratio * 2 * pi - pi / 2) + 1) / 2
        color = (
            round(46 + (152 - 46) * blend),
            round(207 + (96 - 207) * blend),
            round(238 + (255 - 238) * blend),
            255,
        )
        draw.line((points[idx], points[idx + 1]), fill=color, width=65, joint="curve")

    # A narrow highlight retains separation in the 16 px tray icon.
    draw.ellipse((473, 472, 551, 550), fill=(13, 24, 53, 255))
    draw.ellipse((491, 490, 533, 532), fill=(119, 226, 244, 255))
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = render()
    image.save(OUT / "icon.png", optimize=True)
    image.save(
        OUT / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    for filename in ("icon.png", "icon.ico"):
        print(f"{filename}: {(OUT / filename).stat().st_size} bytes")


if __name__ == "__main__":
    main()