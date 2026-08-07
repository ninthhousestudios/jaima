"""arati-timing.py — find the arati recording's stanza clock, for the lyrics.

    python3 tools/arati-timing.py                    # docs/arati-master.webm
    python3 tools/arati-timing.py path/to/arati.m4a

The lyrics panel scrolls in step with the YouTube recording, and it does that
off two numbers rather than a hand-typed cue sheet: where the first stanza
begins, and how long one stanza lasts. Both go to `LEAD_S` and `STANZA_S` in
`src/components/arati-lyrics.ts`. The recording itself never ships — it is the
Math's — so this script is how those two numbers can be checked.

Two numbers is enough because this bhajan is strictly strophic: ten stanzas to
one melody, sung at one tempo, with no bridge and no repeat that is not itself
a stanza. That is not an assumption — it is what the measurement finds:

  * The period comes from the chroma self-similarity at every lag. One peak,
    at 36.47 s, with its harmonics at 2x and 3x and nothing else above the
    floor. A song with a bridge does not do that.
  * The phase comes from a checkerboard novelty curve: of every offset within
    one period, which one puts all ten boundaries on a moment where the music
    changes. The winner is sharp — the runners-up are its own neighbours a
    twentieth of a second away, not some other part of the bar.
  * Ten cycles then fill the recording from the phase to its last second, and
    the text has exactly ten stanzas.

What it cannot tell you is which line inside a stanza is being sung when. The
web side spreads a stanza's lines evenly across its period, which is right at
every stanza boundary and can be a second or two out in between. If you want
better, you have to listen — but retune LEAD_S first, since a constant error
there is what an ear notices, and a stanza's inner drift is not.
"""

import sys

import numpy as np

from audio_loop import decode

SR = 22050
HOP = 512
NFFT = 2048

# The period search, in seconds of lag. Wider than any stanza either way: the
# winner has to be compared against its own neighbourhood (see `period`), so a
# candidate sitting at the edge of the range cannot be judged at all.
PERIOD_LO, PERIOD_HI = 4.0, 150.0

# Half-width of that neighbourhood, in seconds of lag. Self-similarity falls
# away with lag whatever the structure, and this is the scale on which that
# falloff is smooth and a repeat is not.
TREND_S = 6.0

# Chroma is folded from this band only: below it is the tanpura's own drone,
# which is constant and would flatten every distinction; above it is breath.
F_LO, F_HI = 80.0, 2000.0

# Half-width of the checkerboard kernel the novelty curve is read off, in
# seconds. It has to span enough music that a stanza boundary looks like a
# change and a phrase boundary inside a stanza does not.
KERNEL_S = 8.0

# The recording ends on the last stanza rather than trailing off, so a final
# cycle running a little past the file is expected. More than this and the
# period or the phase is wrong.
OVERRUN_S = 5.0


def chromagram(sig):
    """Per-frame, L2-normalised pitch-class energy. The 'what chord' curve."""
    win = np.hanning(NFFT)
    frames = 1 + (len(sig) - NFFT) // HOP
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    with np.errstate(divide="ignore"):
        midi = 69 + 12 * np.log2(np.maximum(freqs, 1e-6) / 440.0)
    band = (freqs > F_LO) & (freqs < F_HI)
    masks = [band & (np.mod(np.round(midi).astype(int), 12) == k) for k in range(12)]

    c = np.empty((frames, 12))
    for i in range(frames):
        mag = np.abs(np.fft.rfft(sig[i * HOP : i * HOP + NFFT] * win))
        for k, m in enumerate(masks):
            c[i, k] = mag[m].sum()
    return c / (np.linalg.norm(c, axis=1, keepdims=True) + 1e-9)


def period(chroma, fps):
    """The lag whose self-similarity stands highest off the local trend."""
    lags = np.arange(int(PERIOD_LO * fps), int(PERIOD_HI * fps))
    score = np.array([np.mean(np.sum(chroma[:-k] * chroma[k:], axis=1)) for k in lags])

    # Similarity falls away with lag whatever the structure, so a raw maximum
    # would only ever name the shortest lag searched. Compare each lag with its
    # own neighbourhood instead — and only where that neighbourhood is whole,
    # because a window running off the end of the array averages fewer values
    # and hands the lags at both edges a trend that is too low to beat.
    half = int(TREND_S * fps)
    trend = np.convolve(score, np.ones(2 * half + 1) / (2 * half + 1), mode="same")
    lift = score - trend
    lift[:half] = lift[-half:] = -np.inf
    return lags[int(np.argmax(lift))] / fps, score, lags, trend, lift


def novelty(chroma, fps):
    """Checkerboard novelty: how unlike the next few seconds are the last few."""
    half = int(KERNEL_S * fps)
    taper = np.outer(np.hanning(2 * half), np.hanning(2 * half))
    kernel = np.ones((2 * half, 2 * half))
    kernel[:half, half:] = -1
    kernel[half:, :half] = -1
    kernel *= taper

    sim = chroma @ chroma.T
    nov = np.zeros(len(chroma))
    for i in range(half, len(chroma) - half):
        nov[i] = np.sum(sim[i - half : i + half, i - half : i + half] * kernel)
    nov = np.maximum(nov, 0.0)
    return nov / (nov.max() + 1e-9), half


def phase(nov, half, p, fps, dur):
    """Which offset within one period lands every boundary on a change."""
    scored = []
    for phi in np.arange(0, p, 0.05):
        idx = (np.arange(phi, dur, p) * fps).astype(int)
        idx = idx[(idx >= half) & (idx < len(nov) - half)]
        if len(idx) < 6:
            continue
        scored.append((float(nov[idx].mean()), float(phi)))
    scored.sort(reverse=True)
    return scored


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "docs/arati-master.webm"
    sig = decode(path, SR).mean(axis=1)
    dur = len(sig) / SR
    print(f"{path}: {dur:.2f} s")

    # A tenth of the STFT rate is plenty for structure and turns the O(n^2)
    # similarity matrix from minutes into a second.
    chroma = chromagram(sig)
    fine_fps = SR / HOP
    fold = 10
    n = (len(chroma) // fold) * fold
    chroma = chroma[:n].reshape(-1, fold, 12).mean(axis=1)
    chroma /= np.linalg.norm(chroma, axis=1, keepdims=True) + 1e-9
    fps = fine_fps / fold

    p, score, lags, trend, lift = period(chroma, fps)
    print(f"\nstanza period  {p:.2f} s")
    print("  lag           similarity  over trend")
    for mult in (1, 2, 3):
        i = int(np.argmin(np.abs(lags - mult * p * fps)))
        print(
            f"  {mult}x = {lags[i] / fps:6.2f} s   {score[i]:.4f}      {score[i] - trend[i]:+.4f}"
        )
    # Every lag that stands clear of its own neighbourhood and is not a
    # multiple of the winner, so a second structure hiding under it is visible
    # rather than silently outvoted.
    rival = [(lift[i], lags[i] / fps) for i in np.argsort(lift)[::-1][:400]]
    rival = [(v, s) for v, s in rival if abs(s / p - round(s / p)) > 0.1][:5]
    print("  strongest lags that are not a multiple of it:")
    for v, s in rival:
        print(f"    {s:6.2f} s  {v:+.4f}")

    nov, half = novelty(chroma, fps)
    scored = phase(nov, half, p, fps, dur)
    lead = scored[0][1]
    print(f"\nfirst stanza   {lead:.2f} s")
    print(
        "  best offsets: " + ", ".join(f"{phi:.2f}s ({v:.3f})" for v, phi in scored[:5])
    )

    stanzas = int(np.floor((dur - lead) / p + 0.5))
    end = lead + stanzas * p
    print(
        f"\n{stanzas} stanzas, {lead:.2f} s to {end:.2f} s (recording ends {dur:.2f} s)"
    )
    for k in range(stanzas):
        print(f"  {k + 1:2d}  {lead + k * p:7.2f} s")
    assert end - dur < OVERRUN_S, (
        f"last stanza runs {end - dur:.1f} s past the recording"
    )

    print("\n--- src/components/arati-lyrics.ts ---")
    print(f"const LEAD_S = {lead:.2f};")
    print(f"const STANZA_S = {p:.2f};")


if __name__ == "__main__":
    main()
