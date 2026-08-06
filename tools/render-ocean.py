#!/usr/bin/env python3
"""render-ocean.py — make the ocean field recordings into loopable beds.

    python3 tools/render-ocean.py

Reads docs/ocean1.wav and docs/ocean2.flac (large, uncompressed, not shipped)
and writes static/audio/ocean1.* and ocean2.* — seamless loops at web sizes.

Unlike the tanpura there is no period to lock the loop to, so the seam is
chosen by search: best_loop_start() scores every candidate window by how
closely its first seconds match the seconds one loop later, in four frequency
bands, and takes the best. Both sources are longer than the loop specifically
to give that search somewhere to look.

Both files are kept. ocean1 is the steadier recording (3.7 dB envelope sd
against ocean2's 5.9) which is what hides a loop, so sound-mode.ts points at
it; ocean2 is the more dramatic one and is one string away if you prefer it.

The recordings are NOT tone-shaped here. Both sit brighter than a temple bed
ideally wants — centroid around 2.5 kHz, a third of the energy above 2 kHz,
which is a waterline perspective rather than distant swell. That is a taste
call, not a defect, and Josh picked these by ear. If you do want them further
away, a high shelf belongs here, not in the browser.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audio_loop import best_loop, crossfade_loop, decode, encode  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "static/audio")

SR = 44100  # both sources are 44.1k; no reason to resample up
CROSSFADE_S = 8.0
PEAK = 0.90  # under the tanpura's ceiling: the sea is a bed, not the voice

# (stem, source, shortest acceptable loop). The upper bound is whatever the
# recording allows; best_loop picks the actual length, because for a periodic
# swell the good lengths are whole numbers of periods and a hardcoded value
# lands on a bad one as easily as a good one.
MIN_LOOP_S = 60.0
SOURCES = [
    ("ocean1", "docs/ocean1.wav"),
    ("ocean2", "docs/ocean2.flac"),
]


def main():
    for stem, rel in SOURCES:
        path = os.path.join(ROOT, rel)
        sig = decode(path, SR)
        sys.stderr.write(
            f"{rel}  {len(sig) / SR:.1f}s  peak {np.max(np.abs(sig)):.3f}\n"
        )

        max_loop_s = len(sig) / SR - CROSSFADE_S
        start, loop_s, score = best_loop(sig, SR, MIN_LOOP_S, max_loop_s, CROSSFADE_S)
        sys.stderr.write(
            f"  loop {loop_s:.0f}s from {start / SR:.2f}s  seam mismatch {score:.2f} dB\n"
        )

        loop_n = int(round(loop_s * SR))
        fade_n = int(round(CROSSFADE_S * SR))
        seg = sig[start : start + loop_n + fade_n]
        loop = crossfade_loop(seg, loop_n, fade_n)

        # These were recorded conservatively (peaks 0.23 / 0.36). Bring them up
        # to a usable level before encoding, or the browser gain node has to do
        # it and drags the noise floor up with it.
        peak = np.max(np.abs(loop))
        loop *= PEAK / peak
        sys.stderr.write(f"  gain {PEAK / peak:.2f}x\n")

        encode(loop, SR, OUT_DIR, stem, peak_ceiling=PEAK)


if __name__ == "__main__":
    main()
