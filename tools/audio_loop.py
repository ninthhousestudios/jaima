"""audio_loop.py — turn a long recording into a seamless web-ready loop.

Shared by render-tanpura.py and render-ocean.py. Underscored, unlike the
hyphenated scripts beside it, because it is imported rather than run.

The loop trick is the same for a synthesised drone and a field recording:
take a segment one crossfade longer than the loop, then fold its tail back
over its head with an equal-power fade. What differs is how you choose the
segment, and that difference is the whole game:

  * A synthesised drone has a known period. The loop length MUST be a whole
    number of those periods or events land at a different phase across the
    seam. The caller computes the length; see render-tanpura.py.
  * A field recording has no period to lock to, so instead you search for a
    window whose head and tail happen to sound alike — best_loop_start().

Either way the seam is only half the job. The other half is in sound-mode.ts:
Opus and AAC carry encoder padding that <audio loop> replays as a gap, so
playback has to go through decodeAudioData and an AudioBufferSourceNode.
"""

import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

# Opus for size, AAC for players that can't decode it.
CODECS = (
    (".opus", ["-c:a", "libopus", "-b:a", "64k"]),
    (".m4a", ["-c:a", "aac", "-b:a", "96k"]),
)


def decode(path, sr):
    """Read any audio file to a float array, shape (n, 2)."""
    raw = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            path,
            "-f",
            "f32le",
            "-ac",
            "2",
            "-ar",
            str(sr),
            "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def band_envelope(sig, sr, hop_s=0.25):
    """Per-frame energy in four bands, in dB — a cheap description of 'sounds like'.

    Level alone is not enough to match a seam: two moments in a wave recording
    can share an RMS while one is a bass swell and the other is foam hiss, and
    splicing those together is audible. Comparing bands catches that.
    """
    mono = sig.mean(axis=1)
    hop = int(hop_s * sr)
    n = len(mono) // hop
    frames = mono[: n * hop].reshape(n, hop)
    spec = np.abs(np.fft.rfft(frames * np.hanning(hop), axis=1))
    freqs = np.fft.rfftfreq(hop, 1 / sr)
    edges = [(0, 200), (200, 800), (800, 3000), (3000, sr / 2)]
    bands = [spec[:, (freqs >= lo) & (freqs < hi)].sum(axis=1) for lo, hi in edges]
    return 20 * np.log10(np.stack(bands, axis=1) + 1e-9)


def _seam_scores(env, loop_f, fade_f):
    """Mean dB mismatch, per candidate start, between the fade-in and the
    material one loop later — exactly what the crossfade will lay over it.

    A moving average over |env[s] - env[s + loop_f]|, taken with a cumulative
    sum so that sweeping hundreds of loop lengths stays cheap.
    """
    diff = np.abs(env[:-loop_f] - env[loop_f:]).mean(axis=1)
    if len(diff) <= fade_f:
        return None
    c = np.concatenate([[0.0], np.cumsum(diff)])
    return (c[fade_f:] - c[:-fade_f]) / fade_f


def best_loop(sig, sr, min_s, max_s, fade_s, hop_s=0.25, step_s=1.0):
    """Search both loop length and start offset for the least audible seam.

    Length is searched rather than fixed because a recording with a periodic
    swell behaves like the tanpura: it wants a whole number of periods, and a
    length that misses one scores far worse than its own neighbours. ocean2 has
    a 14 s swell and goes from 2.4 dB at 110 s to 7.3 dB at 115 s — a magic
    number in the caller would have silently picked the bad one.

    Ties break toward longer loops, a longer loop being a less recognisable
    one, so a shorter length only wins if it is meaningfully better. Returns
    (start_sample, loop_seconds, score); score is mean dB mismatch, and under
    about 2 dB is inaudible in practice.
    """
    env = band_envelope(sig, sr, hop_s)
    fade_f = int(round(fade_s / hop_s))
    best = None

    for loop_s in np.arange(min_s, max_s + step_s, step_s):
        loop_f = int(round(loop_s / hop_s))
        if len(env) - loop_f - fade_f <= 0:
            break
        scores = _seam_scores(env, loop_f, fade_f)
        if scores is None:
            break
        start_f = int(np.argmin(scores))
        score = float(scores[start_f])
        # 0.1 dB per extra 10 s: enough to prefer length among near-equals, not
        # enough to trade an audible seam for it.
        adjusted = score - 0.01 * loop_s
        if best is None or adjusted < best[0]:
            best = (adjusted, int(start_f * hop_s * sr), float(loop_s), score)

    if best is None:
        raise ValueError(
            f"recording too short for a {min_s:.0f}s loop + {fade_s:.0f}s fade"
        )
    return best[1], best[2], best[3]


def crossfade_loop(seg, loop_n, fade_n):
    """Fold seg's tail back over its head. seg must be loop_n + fade_n long."""
    if len(seg) < loop_n + fade_n:
        raise ValueError(
            f"segment {len(seg)} shorter than loop {loop_n} + fade {fade_n}"
        )
    loop = seg[:loop_n].copy()
    x = np.linspace(0.0, 1.0, fade_n, endpoint=False)[:, None]
    # Equal power, so the overlap doesn't dip in the middle of the seam.
    loop[:fade_n] = seg[:fade_n] * np.sin(x * np.pi / 2) + seg[
        loop_n : loop_n + fade_n
    ] * np.cos(x * np.pi / 2)
    return loop


def encode(sig, sr, out_dir, stem, peak_ceiling=0.98):
    """Normalise to a ceiling and write one file per web codec."""
    peak = np.max(np.abs(sig))
    if peak > peak_ceiling:
        sig = sig * (peak_ceiling / peak)
        sys.stderr.write(f"  limited: scaled by {peak_ceiling / peak:.3f}\n")
    sys.stderr.write(
        f"  peak {peak:.4f}  seam delta {np.max(np.abs(sig[0] - sig[-1])):.5f}"
        f"  dur {len(sig) / sr:.1f}s\n"
    )

    os.makedirs(out_dir, exist_ok=True)
    fd, raw = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with wave.open(raw, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(sig, -1, 1) * 32767).astype(np.int16).tobytes())

    for ext, args in CODECS:
        dest = os.path.join(out_dir, stem + ext)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", raw] + args + [dest],
            check=True,
        )
        sys.stderr.write(f"  wrote {dest}  {os.path.getsize(dest) / 1024:.0f} KB\n")
    os.remove(raw)
