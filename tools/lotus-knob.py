#!/usr/bin/env python3
"""Cut the lotus out of docs/lotus.jpg for the nav's centre knob.

    python3 tools/lotus-knob.py

The flower is pink to gold on a dark green leaf, so red-minus-green separates
it from the background far more cleanly than luminance does: every petal, even
the ones in shadow at the bottom left, has R well above G, and every leaf and
shadow pixel has G at or above R.

Output is a single PNG, not a @2x/@3x set -- it is one small decoration and the
SVG <image> that consumes it cannot take a srcset anyway, so it is rendered at
3x the display size and left for the browser to downscale.

The script prints the cut-out's aspect ratio. That number goes into the
<image> width/height in lotus-nav.ts; get it wrong and the flower squashes.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "lotus.jpg"
OUT = ROOT / "static" / "images" / "lotus" / "lotus.png"

# Keep a pixel if red leads green by this much. Low enough to hold the pale
# gold centre (where R and G are close), high enough to reject the leaf.
RED_LEAD = 16
# ...and if it is not simply dark. Rejects the near-black left margin, which
# is noisy enough that a few pixels there squeak past RED_LEAD.
MIN_VALUE = 34

# Padding around the flower, as a fraction of its bounding box, so the tips
# do not sit hard against the edge of the image.
PAD = 0.02
# Long edge of the emitted PNG: 3x a ~64px knob.
TARGET = 192
# Softens the cut edge so it does not read as a sticker against the dark room.
FEATHER = 1.2


def largest_blob(mask: np.ndarray) -> np.ndarray:
    """Flood the biggest connected region, dropping speckle elsewhere.

    Written by hand rather than with scipy.ndimage.label -- scipy is not a
    dependency of this project and one flood fill does not justify adding it.
    """
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best: list[tuple[int, int]] = []

    ys, xs = np.nonzero(mask)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        stack = [(sy, sx)]
        seen[sy, sx] = True
        region = []
        while stack:
            y, x = stack.pop()
            region.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(region) > len(best):
            best = region

    out = np.zeros_like(mask)
    idx = np.array(best)
    out[idx[:, 0], idx[:, 1]] = True
    return out


def main() -> None:
    src = Image.open(SOURCE).convert("RGB")
    arr = np.asarray(src).astype(np.int16)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]

    mask = ((r - g) > RED_LEAD) & (arr.max(axis=2) > MIN_VALUE)

    # Close, then open: seals the veins and the dark gaps between petals, then
    # removes the speckle the closing promoted along the leaf edge.
    m = Image.fromarray((mask * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    m = m.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))

    mask = largest_blob(np.asarray(m) > 127)
    # Fill interior holes by flooding the background in from the border: any
    # unset pixel the border cannot reach is inside the flower.
    outside = largest_blob(~mask | _border_seed(mask.shape))
    mask = ~outside

    ys, xs = np.nonzero(mask)
    y0, y1 = ys.min(), ys.max() + 1
    x0, x1 = xs.min(), xs.max() + 1
    pad_y = int((y1 - y0) * PAD)
    pad_x = int((x1 - x0) * PAD)
    y0, y1 = max(0, y0 - pad_y), min(mask.shape[0], y1 + pad_y)
    x0, x1 = max(0, x0 - pad_x), min(mask.shape[1], x1 + pad_x)

    alpha = Image.fromarray((mask * 255).astype(np.uint8)).crop((x0, y0, x1, y1))
    flower = src.crop((x0, y0, x1, y1))

    w, h = flower.size
    scale = TARGET / max(w, h)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    flower = flower.resize(size, Image.LANCZOS)
    alpha = alpha.resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(FEATHER))

    flower.putalpha(alpha)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    flower.save(OUT)

    print(f"wrote {OUT.relative_to(ROOT)}  {size[0]}x{size[1]}")
    print(
        f"aspect ratio  {size[0] / size[1]:.4f}   -> <image> width/height in lotus-nav.ts"
    )
    print(f"coverage      {mask[y0:y1, x0:x1].mean():.1%} of the cut-out is flower")


def _border_seed(shape: tuple[int, int]) -> np.ndarray:
    seed = np.zeros(shape, dtype=bool)
    seed[0, :] = seed[-1, :] = True
    seed[:, 0] = seed[:, -1] = True
    return seed


if __name__ == "__main__":
    main()
