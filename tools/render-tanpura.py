#!/usr/bin/env python3
"""render-tanpura.py — the temple drone: two tanpuras, staggered, in a stone room.

    python3 tools/render-tanpura.py

Writes static/audio/tanpura.opus and .m4a — a seamlessly loopable 100 s bed.

Why two takes and not one
------------------------
One tanpura is a sequence of plucks; two are a wash. The second take is tuned
DETUNE_CENTS sharp (two people tuning to the same Sa never land on it exactly,
and the slow beat between them is most of the atmosphere) and offset by half a
pluck cycle, so its plucks fall in the gaps of the first. They are panned apart
rather than centred, which is what puts them in the room instead of in a mix.

Why the loop length is not a round number of your choosing
----------------------------------------------------------
LOOP_S must be an exact multiple of the pluck cycle (1 / pluck_rate). The
crossfade overlays the segment against itself LOOP_S later, so if the loop is
not a whole number of cycles the plucks land at a different phase across the
seam and the drone develops an audible hitch once per loop. At pluck_rate 0.09
the cycle is 11.111 s and 9 cycles is exactly 100 s, which is why those two
numbers are what they are. Change the rate and you must re-pick the multiple.

The string model is justifier's — this script only supplies the temple's
parameters. Requires the justifier checkout beside this one, plus faust, g++
and ffmpeg. See justifier/native/experiments/temple_tanpura.dsp.
"""

import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
JUSTIFIER = os.path.join(os.path.dirname(ROOT), "justifier")
RENDER = os.path.join(JUSTIFIER, "native/tools/render.sh")
DSP = os.path.join(JUSTIFIER, "native/experiments/temple_tanpura.dsp")
OUT_DIR = os.path.join(ROOT, "static/audio")

SR = 48000
SA = 130.81  # C3

# Temple voicing. Every one of these is a knob the ensemble already exposes;
# together they are the difference between a practice reference and a drone
# you can sit in front of for an hour.
PLUCK_RATE = 0.09  # plucks/sec/string — a pluck every 11 s, not every 5
VOICE = {
    "pluck_rate": PLUCK_RATE,
    "jivari": 0.22,  # less bridge buzz: the drone recedes
    "brightness": 0.15,
    "warmth_hz": 1600.0,  # darker than the 2800 the practice drone wants
    "pluck_gain": 0.22,  # softer attacks
    "exc_cutoff": 450.0,
    "sustain_time": 0.97,  # long ring, so plucks overlap into a wash
    "pol_detune": 2.6,  # wider intra-string beating
    "body_mix": 0.40,
    "rev_t60": 5.0,
    "wet": 0.38,
}

DETUNE_CENTS = 4.5  # take B, sharp of take A
CYCLE_S = 1.0 / PLUCK_RATE  # 11.111 s
STAGGER_S = CYCLE_S / 2.0  # B's plucks fall in A's gaps
LOOP_S = 9 * CYCLE_S  # 100.0 s — must stay a whole cycle count
CROSSFADE_S = 8.0
LEAD_IN_S = 25.0  # discarded: strings and reverb reaching steady state
GAIN = 6.0  # the ensemble's 0.39 trim leaves a lot of headroom


def render(detune, secs):
    """Render one take of the ensemble to a float array, shape (n, 2)."""
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    args = [
        RENDER,
        DSP,
        path,
        f"{secs:.3f}",
        f"freq={SA:.4f}",
        "amp=0.8",
        "gate=1",
        f"detune={detune}",
    ] + [f"{k}={v}" for k, v in VOICE.items()]
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)
    with wave.open(path, "rb") as w:
        assert w.getnchannels() == 2, "temple_tanpura should render stereo"
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    os.remove(path)
    return raw.astype(np.float64).reshape(-1, 2) / 32768.0


def pan(sig, toward_left):
    """Lean a stereo take to one side while keeping its reverb width."""
    near, far, bleed_near, bleed_far = 0.95, 0.60, 0.30, 0.25
    l, r = sig[:, 0], sig[:, 1]
    if toward_left:
        return np.stack([near * l + bleed_near * r, bleed_far * l + far * r], axis=1)
    return np.stack([far * l + bleed_far * r, bleed_near * l + near * r], axis=1)


def main():
    stagger = int(STAGGER_S * SR)
    lead_in = int(LEAD_IN_S * SR)
    loop_n = int(round(LOOP_S * SR))
    fade_n = int(CROSSFADE_S * SR)
    secs = LEAD_IN_S + LOOP_S + CROSSFADE_S + STAGGER_S + 2.0

    sys.stderr.write(
        f"cycle {CYCLE_S:.3f}s  loop {LOOP_S:.1f}s ({LOOP_S / CYCLE_S:.0f} cycles)"
        f"  render {secs:.1f}s x2\n"
    )

    a = pan(render(0.0, secs), toward_left=True)
    b = pan(render(DETUNE_CENTS, secs), toward_left=False)

    # out[t] = A[t] + B[t - stagger]
    n = min(len(a), len(b) + stagger)
    mix = a[:n].copy()
    mix[stagger:n] += b[: n - stagger]
    mix *= GAIN

    # Window past the lead-in, long enough to fold its own tail back over its head.
    seg = mix[lead_in : lead_in + loop_n + fade_n]
    assert len(seg) == loop_n + fade_n, "render too short for the requested loop"

    loop = seg[:loop_n].copy()
    x = np.linspace(0.0, 1.0, fade_n, endpoint=False)[:, None]
    # Equal power, so the overlap doesn't dip in the middle of the seam.
    loop[:fade_n] = seg[:fade_n] * np.sin(x * np.pi / 2) + seg[
        loop_n : loop_n + fade_n
    ] * np.cos(x * np.pi / 2)

    peak = np.max(np.abs(loop))
    sys.stderr.write(
        f"peak {peak:.4f}  seam delta {np.max(np.abs(loop[0] - loop[-1])):.5f}\n"
    )
    if peak > 0.98:
        loop *= 0.98 / peak
        sys.stderr.write(f"  (limited: scaled by {0.98 / peak:.3f})\n")

    os.makedirs(OUT_DIR, exist_ok=True)
    fd, raw_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with wave.open(raw_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(loop, -1, 1) * 32767).astype(np.int16).tobytes())

    # Two codecs because Opus is much smaller and older Safari only has AAC.
    # Both get decoded to an AudioBuffer, which strips the encoder padding that
    # would otherwise put a gap in the loop — see sound-mode.ts.
    for name, enc in (
        ("tanpura.opus", ["-c:a", "libopus", "-b:a", "64k"]),
        ("tanpura.m4a", ["-c:a", "aac", "-b:a", "96k"]),
    ):
        dest = os.path.join(OUT_DIR, name)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", raw_path] + enc + [dest],
            check=True,
        )
        sys.stderr.write(f"wrote {dest}  {os.path.getsize(dest) / 1024:.0f} KB\n")
    os.remove(raw_path)


if __name__ == "__main__":
    main()
