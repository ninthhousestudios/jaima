"""arati-timing.py — find the arati recording's stanza clock, for the lyrics.

    python3 tools/arati-timing.py                    # docs/arati-master.webm
    python3 tools/arati-timing.py path/to/arati.m4a

The lyrics panel scrolls in step with the YouTube recording, and it does that
off two numbers rather than a hand-typed cue sheet: where the first stanza
begins, and how long one stanza lasts. Both go to `LEAD_S` and `STANZA_S` in
`src/components/arati-lyrics.ts`. The recording itself never ships — it is the
Math's — so this script is how those two numbers can be checked.

Two numbers is enough because this bhajan is strictly strophic: one melody at
one tempo, with no bridge and no repeat that is not itself a stanza. That is
not an assumption — it is what the period measurement finds. The chroma
self-similarity at every lag has one peak, at 36.46 s, with its harmonics at 2x
and 3x and nothing else near the floor; a song with a bridge does not do that.
The same peak comes back at 36.46 s when only the sung part is measured.

**The phase is measured off the singing, and it has to be.** The first attempt
read it from a chroma novelty curve — of every offset within one period, which
puts the boundaries on a moment where the music changes — and it was wrong by
14.6 s, which the browser showed as the highlight running a good line ahead of
the voice. The reason is worth keeping: this recording opens with one full
instrumental cycle of the same melody. Anything reading harmony cannot tell
that cycle from a sung one, so it locks onto the arrangement instead of the
words. The voice band can:

  * A 500-4000 Hz envelope has a floor of 27 dB through the intro and 54 dB
    once the singing starts. The onset is unambiguous at 36.6 s, the end at
    378.1 s.
  * Folding that envelope at the period, over the sung part only, gives one
    stanza's shape averaged over all of them. It has three troughs — the
    breaths after each of the three lines — and the deepest is the gap between
    stanzas. Where the envelope climbs back through its mean after that gap is
    where a stanza begins.

That lands the ten stanzas at 36.68 s + 36.46k. The last of them is the short
`jai bolo` coda: singing stops at 378.1 s, so it gets 13 s of a 36.46 s slot,
and its second line lights near the end of the recording rather than on the
shout. Two constants buy everything else and not that; it was not worth a
third.

What none of this can tell you is which line inside a stanza is being sung
when. The web side spreads a stanza's lines evenly across its period, which is
right at every stanza boundary and can be a second or two out in between. If
you want better you have to listen — but check LEAD_S first, since a constant
error there is what an ear notices and a stanza's inner drift is not.
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

# The voice band the phase is read off. Above the drone and the harmonium's
# fundamentals, below the point where all that is left is breath and cymbal.
V_LO, V_HI = 500.0, 4000.0

# The voice envelope is smoothed over this long before anything is read off it.
# A syllable's own gaps are shorter than this and a breath between lines is
# not, which is the whole distinction the fold depends on.
SMOOTH_S = 1.0

# The singing is taken to have started once the envelope is over the threshold
# and stays there for this long. Long enough that a single loud stroke in the
# intro cannot pass for a voice.
HOLD_S = 4.0


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


def voice(sig):
    """Smoothed level in the voice band, in dB. The 'someone is singing' curve."""
    win = np.hanning(NFFT)
    frames = 1 + (len(sig) - NFFT) // HOP
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    band = (freqs > V_LO) & (freqs < V_HI)

    env = np.empty(frames)
    for i in range(frames):
        env[i] = np.abs(np.fft.rfft(sig[i * HOP : i * HOP + NFFT] * win))[band].sum()
    env = 20 * np.log10(env + 1e-9)

    fps = SR / HOP
    k = int(SMOOTH_S * fps)
    return np.convolve(env, np.ones(k) / k, mode="same"), fps


def sung_span(env, fps):
    """When the singing starts and stops, and the two levels that decide it."""
    # Both levels are read off the recording rather than assumed: the intro's
    # own floor, and the median of the middle of the piece, which is singing by
    # any reading. Halfway between them separates the two by a wide margin.
    floor = float(np.percentile(env[: int(25 * fps)], 60))
    sung = float(np.percentile(env[int(60 * fps) : int(280 * fps)], 50))
    threshold = (floor + sung) / 2

    hold = int(HOLD_S * fps)

    def edge(order):
        for i in order:
            window = env[i : i + hold] if i < len(env) // 2 else env[i - hold : i]
            if env[i] > threshold and (window > threshold - 3).mean() > 0.9:
                return i / fps
        return None

    start = edge(range(len(env) - hold))
    end = edge(range(len(env) - hold, hold, -1))
    return start, end, floor, sung, threshold


def phase(env, fps, p, start, end):
    """
    Where in the cycle a stanza begins, averaged over every stanza there is.

    Folding the voice envelope at the period gives one stanza's shape: three
    troughs, one per line, the deepest of them the gap between stanzas. The
    stanza begins where the envelope climbs back through its own mean out of
    that gap.

    The first sung cycle is left out of the fold. It is the one the voice comes
    in on, so its opening is a step up from an instrumental floor rather than
    the breath every other stanza opens after, and averaging it in drags the
    crossing early.
    """
    lo = start + p
    seg = env[int(lo * fps) : int(end * fps)]
    bins = 292
    at = (((np.arange(len(seg)) / fps + lo) % p) / p * bins).astype(int) % bins
    profile = np.array([seg[at == k].mean() for k in range(bins)])
    profile -= profile.mean()

    trough = int(np.argmin(profile))
    k = trough
    while profile[k % bins] <= 0 and k - trough <= bins:
        k += 1
    # Interpolate the crossing rather than taking the bin, so the answer does
    # not step by a quarter second with the histogram.
    before, after = profile[(k - 1) % bins], profile[k % bins]
    frac = -before / (after - before)
    return ((k - 1 + frac) % bins) / bins * p, profile, trough


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

    env, vfps = voice(sig)
    start, end, floor, sung, threshold = sung_span(env, vfps)
    print(f"\nvoice band     intro floor {floor:.1f} dB, sung {sung:.1f} dB")
    print(f"  singing runs {start:.2f} s to {end:.2f} s")
    assert start is not None and end is not None, "no singing found in the voice band"
    assert sung - floor > 10.0, (
        f"voice band only rises {sung - floor:.1f} dB; the phase cannot be trusted"
    )

    at, profile, trough = phase(env, vfps, p, start, end)
    print(
        f"  folded at {p:.2f} s, the stanza gap is at phase {trough / len(profile) * p:.2f} s"
    )
    print(f"  the envelope climbs back through its mean at phase {at:.2f} s")

    # The first boundary at or after the onset. Anything earlier is inside the
    # instrumental opening, which is what the chroma phase used to pick.
    lead = at + p * float(np.ceil((start - at) / p))
    assert start <= lead < start + p, f"lead {lead:.2f} is not the first boundary sung"

    stanzas = int(np.ceil((end - lead) / p))
    print(
        f"\n{stanzas} stanzas from {lead:.2f} s, the last one a {end - lead - (stanzas - 1) * p:.1f} s coda"
    )
    for k in range(stanzas):
        print(f"  {k + 1:2d}  {lead + k * p:7.2f} s")
    print(f"  singing stops {end:.2f} s, recording ends {dur:.2f} s")

    print("\n--- src/components/arati-lyrics.ts ---")
    print(f"const LEAD_S = {lead:.2f};")
    print(f"const STANZA_S = {p:.2f};")


if __name__ == "__main__":
    main()
