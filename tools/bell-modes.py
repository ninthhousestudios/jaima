"""bell-modes.py — measure a ghanta recording's modes, for the synth to replay.

    python3 tools/bell-modes.py                      # docs/ganta-bell.mp3
    python3 tools/bell-modes.py docs/gantee-2.flac   # a different reference

The bell on the ledge is synthesised, not sampled — a synth can vary its
timbre with how hard the clapper lands, which a recording cannot. But the
numbers the synth plays are measured from a real bell, by this script: a
struck bell is a set of decaying modes, so its whole voice is a short table
of (frequency, level, decay, beat). The table goes to `MODES` in
`src/components/bell-voice.ts`; the recording itself never ships.

`beat` is the audible shimmer: a bell's near-degenerate mode pairs are split
a few Hz apart by its asymmetries (the clapper, the Nandi), and the pair
beats. The analysis FFT spans seconds precisely so those pairs resolve as
two peaks instead of one.

Alongside the table it renders `docs/bell-preview.wav` — soft, medium and
hard strikes plus a fast ring, synthesised from the measured table with the
same brightness law the web side uses. Listen to it against the reference
before wiring anything; if the preview is wrong the browser will be too.
"""

import sys

import numpy as np

from audio_loop import decode

SR = 44100

# Everything a small ghanta says lives well inside this band; below it is
# room rumble and handling noise, above it the mp3's own cutoff looms.
F_LO, F_HI = 300.0, 10000.0

# Skip this much of the tail before analysing: the clapper's contact is a
# broadband burst that would smear every peak it touches.
SKIP_S = 0.03

# A peak must stand this far off the local spectral floor to be a mode.
PROMINENCE_DB = 18.0

# Two peaks closer than this are one beating pair, not two modes.
PAIR_HZ = 12.0

MAX_MODES = 8

# The preview's brightness law — one-pole lowpass whose cutoff follows the
# strike force. Mirror of the BiquadFilter in bell-voice.ts.
CUTOFF_LO, CUTOFF_HI = 1200.0, 10000.0


def mono(path):
    return decode(path, SR).mean(axis=1)


def strikes(sig):
    """Onset indices, from jumps in a short-hop RMS envelope."""
    hop = int(0.005 * SR)
    n = len(sig) // hop
    env = np.sqrt((sig[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    floor = env.max() * 0.02
    onsets = []
    for i in range(2, n):
        recent = env[max(0, i - 8) : i].max()
        if (
            env[i] > floor
            and env[i] > 4 * max(recent, floor)
            and (not onsets or i * hop - onsets[-1] > int(0.25 * SR))
        ):
            onsets.append(i * hop)
    return onsets


def best_tail(sig, onsets):
    """The strike with the longest clean ring after it."""
    ends = onsets[1:] + [len(sig)]
    start, end = max(zip(onsets, ends), key=lambda p: p[1] - p[0])
    a = start + int(SKIP_S * SR)
    return a, min(end, a + int(4.0 * SR))


def pick_peaks(seg):
    """(freq, dB) of every prominent spectral peak in the band."""
    win = np.hanning(len(seg))
    pad = 4 * len(seg)
    mag = np.abs(np.fft.rfft(seg * win, pad))
    db = 20 * np.log10(mag + 1e-12)
    freqs = np.fft.rfftfreq(pad, 1 / SR)

    # The local floor is a wide moving average; a mode is a needle above it.
    width = max(1, int(200.0 / (freqs[1] - freqs[0])))
    kernel = np.ones(width) / width
    floor = np.convolve(db, kernel, mode="same")

    band = (freqs >= F_LO) & (freqs <= F_HI)
    idx = np.flatnonzero(
        band
        & (db > floor + PROMINENCE_DB)
        & (db > np.roll(db, 1))
        & (db >= np.roll(db, -1))
    )
    peaks = []
    for i in idx:
        # Parabolic interpolation for a sub-bin frequency.
        a, b, c = db[i - 1], db[i], db[i + 1]
        d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
        peaks.append(((i + d) * (freqs[1] - freqs[0]), b))
    # Strongest first, and never two from the shoulders of one peak.
    peaks.sort(key=lambda p: -p[1])
    kept = []
    for f, l in peaks:
        if all(abs(f - g) > 3.0 for g, _ in kept):
            kept.append((f, l))
    return kept


def group_pairs(peaks):
    """Merge peaks into modes; a close pair becomes one mode with a beat."""
    modes = []
    used = [False] * len(peaks)
    order = sorted(range(len(peaks)), key=lambda i: -peaks[i][1])
    for i in order:
        if used[i]:
            continue
        f, l = peaks[i]
        mate = None
        for j in order:
            if j != i and not used[j] and abs(peaks[j][0] - f) <= PAIR_HZ:
                mate = j
                break
        if mate is None:
            modes.append({"freq": f, "level": l, "beat": 0.0})
        else:
            g, m = peaks[mate]
            used[mate] = True
            modes.append({"freq": (f + g) / 2, "level": max(l, m), "beat": abs(f - g)})
        used[i] = True
    modes.sort(key=lambda d: d["freq"])
    return modes[:MAX_MODES]


def fit_decays(sig, a, b, modes):
    """Per-mode decay time constant, from an STFT magnitude track.

    exp(-t/tau) falls 8.686/tau dB per second, so tau comes off the slope of
    a line fitted to the track in dB. The fit intercept at the strike is the
    mode's true starting level — the long FFT's peak height favours slow
    decays, which have more energy to integrate, so it is not used for `amp`.
    """
    win_n, hop = 4096, 1024
    seg = sig[a:b]
    frames = 1 + (len(seg) - win_n) // hop
    win = np.hanning(win_n)
    stft = np.array(
        [
            np.abs(np.fft.rfft(seg[i * hop : i * hop + win_n] * win))
            for i in range(frames)
        ]
    )
    freqs = np.fft.rfftfreq(win_n, 1 / SR)
    t = np.arange(frames) * hop / SR

    for m in modes:
        bin_ = int(round(m["freq"] / freqs[1]))
        track = stft[:, bin_ - 1 : bin_ + 2].max(axis=1)
        db = 20 * np.log10(track + 1e-12)
        # Fit only while the mode is still ringing above its own noise.
        lo = db.max() - 35
        keep = db > lo
        # A beating pair dips below the line twice a beat; the fit rides
        # through because the dips are symmetric about it.
        if keep.sum() < 6:
            m["tau"], m["amp_db"] = 0.3, db.max()
            continue
        slope, intercept = np.polyfit(t[keep], db[keep], 1)
        m["tau"] = float(np.clip(-8.686 / slope, 0.05, 12.0)) if slope < 0 else 12.0
        m["amp_db"] = float(intercept)
    return modes


# The playback chain bell-voice.ts puts every strike through, mirrored so the
# preview is an audition of what ships and not of the mode table alone. KEEP
# THESE IN STEP with the constants of the same name over there: the preview
# used to model none of them, which is exactly how a bell that clanged in the
# browser sounded clean here.
LEVEL = 0.3
DUCK = 0.75
MAX_RINGING = 8
SAT = 1.0
HEAD = 4
# What the escapement in puja-bell.ts actually settles at: a swing period of
# about 27 frames, so a strike at every turn is one every 225 ms, and it turns
# over at a speed of 4.0 against a FULL_OMEGA of 6. Run that integrator and it
# gives the same two numbers every time — the self-ring is not a range, it is
# one fixed swing repeated for as long as it is left going, which is why it is
# worth auditioning on its own.
AUTO_GAP = 0.225
AUTO_FORCE = 4.0 / 6


def fold(x):
    """The saturation bus, curve and pad together."""
    return np.tanh(SAT * np.clip(x / HEAD, -1, 1) * HEAD) / SAT


def synth_strike(modes, force, dur, rng):
    """One strike, the same model bell-voice.ts plays.

    Every partial starts at phase zero, because an OscillatorNode does and
    there is no way to ask it not to. That is not a detail: strikes a fifth of
    a second apart at the same seven frequencies land in and out of phase with
    each other, and rendering them from random phases here averaged away the
    one thing worth auditioning.
    """
    t = np.arange(int(dur * SR)) / SR
    cutoff = CUTOFF_LO + force * (CUTOFF_HI - CUTOFF_LO)
    out = np.zeros_like(t)
    for m in modes:
        # One-pole lowpass magnitude — the brightness the force buys.
        bright = 1 / np.sqrt(1 + (m["freq"] / cutoff) ** 2)
        amp = m["amp"] * bright * 10 ** (rng.uniform(-2, 2) / 20)
        env = np.exp(-t / m["tau"])
        if m["beat"] > 0.05:
            half = m["beat"] / 2 + rng.uniform(-0.3, 0.3)
            out += (
                amp
                / 2
                * env
                * (
                    np.sin(2 * np.pi * (m["freq"] - half) * t)
                    + np.sin(2 * np.pi * (m["freq"] + half) * t)
                )
            )
        else:
            out += (
                amp * env * np.sin(2 * np.pi * (m["freq"] + rng.uniform(-0.3, 0.3)) * t)
            )
    # The clapper: a few ms of band-limited noise, or the strike fades in.
    tick = rng.standard_normal(len(t)) * np.exp(-t / 0.006)
    spec = np.fft.rfft(tick)
    f = np.fft.rfftfreq(len(t), 1 / SR)
    spec[(f < 1500) | (f > min(cutoff, 9000))] = 0
    out += 0.35 * force * np.fft.irfft(spec, len(t))
    return force * out


def render_preview(modes, path):
    rng = np.random.default_rng(7)
    peak = max(m["amp"] for m in modes)
    for m in modes:
        m["amp"] /= peak
    out = np.zeros(int(30 * SR))

    def put(at, force, dur=4.0, scale=None):
        s = synth_strike(modes, force, dur, rng)
        if scale is not None:
            s = s * scale
        i = int(at * SR)
        out[i : i + len(s)] += s[: max(0, len(out) - i)]

    put(0.5, 0.3)
    put(4.0, 0.65)
    put(7.5, 1.0)
    single = np.abs(out).max()

    # The auto-ring, at the rate the escapement really runs it, with the
    # clapper's damping of the tails already sounding and the cap on how many
    # of them there are. Rendered at half that rate and with neither, this
    # section stayed politely under a lone strike while the browser was
    # throwing 8 dB accents on whichever strike landed in phase.
    at = [11.0 + k * AUTO_GAP for k in range(20)]
    span = 13.0
    n = int(span * SR)
    for k, t0 in enumerate(at):
        scale = np.ones(n)
        for m, t1 in enumerate(at[k + 1 :], 1):
            j = int((t1 - t0) * SR)
            if j >= n:
                break
            scale[j:] *= DUCK
            if m >= MAX_RINGING:
                scale[j:] = 0
                break
        put(t0, AUTO_FORCE, span, scale)

    ring = np.abs(out[int(11 * SR) :]).max()
    # Level and fold, not a normalise. Normalising is what let the ring's own
    # level go unreported for as long as it did.
    out = fold(LEVEL * out)
    print(
        f"\n  peak: one hard strike {LEVEL * single:.2f}, the auto-ring"
        f" {LEVEL * ring:.2f} ({20 * np.log10(ring / single):+.1f} dB) into a"
        f" fold that ceilings at {1 / SAT:.2f}"
    )

    import wave

    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((out * 32767).astype(np.int16).tobytes())


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "docs/ganta-bell.mp3"
    sig = mono(src)
    onsets = strikes(sig)
    if not onsets:
        sys.exit(f"{src}: no strike found")
    a, b = best_tail(sig, onsets)
    print(f"{src}: {len(onsets)} strike(s); analysing {a / SR:.2f}s..{b / SR:.2f}s")

    modes = group_pairs(pick_peaks(sig[a:b]))
    modes = fit_decays(sig, a, b, modes)

    top = max(m["amp_db"] for m in modes)
    for m in modes:
        m["amp"] = 10 ** ((m["amp_db"] - top) / 20)

    f0 = modes[0]["freq"]
    print(f"\n  {'freq':>8}  {'ratio':>6}  {'amp':>6}  {'tau':>5}  {'beat':>5}")
    for m in modes:
        print(
            f"  {m['freq']:8.1f}  {m['freq'] / f0:6.2f}  {m['amp']:6.3f}"
            f"  {m['tau']:5.2f}  {m['beat']:5.1f}"
        )

    print("\nMODES for src/components/bell-voice.ts:")
    rows = ",\n".join(
        f"  [{m['freq']:.1f}, {m['amp']:.3f}, {m['tau']:.2f}, {m['beat']:.1f}]"
        for m in modes
    )
    print(f"const MODES: [number, number, number, number][] = [\n{rows},\n];")

    render_preview(modes, "docs/bell-preview.wav")
    print("\ndocs/bell-preview.wav: soft, medium, hard, then the auto-ring —")
    print("listen against the reference before touching bell-voice.ts.")


if __name__ == "__main__":
    main()
