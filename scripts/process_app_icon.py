"""Turn the selected ImageGen concept into flat, transparent app-icon assets."""

from pathlib import Path

import numpy as np
from PIL import Image


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
SOURCE = PACKAGE_ROOT / "assets" / "app-icon-source.png"
OUTPUT = PACKAGE_ROOT / "assets" / "app-icon.png"
ICO_OUTPUT = PACKAGE_ROOT / "assets" / "app-icon.ico"


def make_transparent_flat_icon(source: Path) -> Image.Image:
    original = Image.open(source).convert("RGB")
    pixels = np.asarray(original, dtype=np.float32) / 255.0
    maximum = pixels.max(axis=2)
    minimum = pixels.min(axis=2)
    luminance = pixels.mean(axis=2)
    saturation = (maximum - minimum) / np.maximum(maximum, 1 / 255)

    # ImageGen returned a light checkerboard instead of alpha. Recover the
    # foreground from saturation/darkness and retain partially-antialiased edges.
    saturation_alpha = np.clip((saturation - 0.035) / 0.14, 0.0, 1.0)
    darkness_alpha = np.clip((0.79 - luminance) / 0.32, 0.0, 1.0)
    alpha = np.maximum(saturation_alpha, darkness_alpha)
    alpha[(saturation < 0.045) & (luminance > 0.79)] = 0.0

    red, green, blue = (pixels[:, :, channel] for channel in range(3))
    cyan = (green > blue * 0.72) & (blue > 0.45) & (red < 0.45)
    chromatic_blue = (blue > red * 1.25) & ~cyan

    flat = np.empty_like(pixels)
    flat[:, :, :] = np.array([0x24, 0x24, 0x24], dtype=np.float32) / 255.0
    flat[chromatic_blue] = np.array([0x0F, 0x6C, 0xBD], dtype=np.float32) / 255.0
    flat[cyan] = np.array([0x00, 0xB7, 0xC3], dtype=np.float32) / 255.0

    rgba = np.dstack((flat, alpha))
    image = Image.fromarray(np.uint8(np.clip(rgba, 0.0, 1.0) * 255), "RGBA")

    bounds = image.getchannel("A").point(lambda value: 255 if value > 10 else 0).getbbox()
    if not bounds:
        raise RuntimeError("No icon foreground was detected")
    cropped = image.crop(bounds)
    side = max(cropped.size)
    margin = round(side * 0.13)
    canvas = Image.new("RGBA", (side + margin * 2, side + margin * 2), (0, 0, 0, 0))
    canvas.alpha_composite(
        cropped,
        ((canvas.width - cropped.width) // 2, (canvas.height - cropped.height) // 2),
    )
    return canvas.resize((1024, 1024), Image.Resampling.LANCZOS)


def main() -> None:
    icon = make_transparent_flat_icon(SOURCE)
    icon.save(OUTPUT, optimize=True)

    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    for size in sizes:
        resized = icon.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(PACKAGE_ROOT / "assets" / f"app-icon-{size}.png", optimize=True)
    icon.save(ICO_OUTPUT, sizes=[(size, size) for size in sizes if size <= 256])


if __name__ == "__main__":
    main()
