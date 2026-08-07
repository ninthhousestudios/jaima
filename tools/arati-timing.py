"""arati-timing.py — measure the arati recording's cue sheet, for the lyrics.

    python3 tools/arati-timing.py                    # docs/arati-master.webm
    python3 tools/arati-timing.py path/to/arati.m4a

The lyrics panel scrolls in step with the YouTube recording, and it does that
off `CUES` in `src/components/arati-lyrics.ts`: one time per stanza, saying
where that stanza starts being sung. This script measures the whole table and
prints it ready to paste. The recording itself never ships — it is the Math's —
so this is how those numbers can be checked.

**This measures the bhajan only, through `jai bolo`.** The pavamāna chants that
close the arati — `asato mā`, `lokāḥ samastāḥ`, the `gurubhyoḥ` salutation, in
docs/pavamana-*.md — are free rhythm, not the strophic bhajan, so there is no
period or template for this machinery to lock onto; those cues are hand-timed
by ear in `arati-lyrics.ts`. When pasting this script's table, keep the tail
rows it does not produce.

**It used to be two numbers, a lead-in and one stanza length, and that was
wrong.** The bhajan is strophic in its melody but not in its tempo. It holds
36.46 s a stanza for five stanzas, accelerates hard at `patitoddhara` to about
17.5, comes back near the opening pace for the `om jaya jaya` reprise, and then
leaves the bhajan altogether for `jai bolo` and the `asato ma` mantra. A single
period put `jai bolo` 41 s late — more than a whole stanza — which is not a
drift anyone can read past. The period measurement did not lie about this; it
was never asked. Self-similarity at one lag reports the *dominant* period of a
recording quite happily while three stanzas run at twice the speed.

## How the table is measured

The structure is taken from the words, not guessed: `docs/arati-iast.md` says
how many stanzas there are, and which one is the reprise — it is the stanza
whose lines repeat the opening's. Everything else is measured off the audio,
and each stage is checked against the one before it.

1. **The voice band, 500-4000 Hz.** 27 dB through the intro, 54 dB once the
   singing starts, so where the singing runs is unambiguous.

   The phase has to come off this band and not off harmony. The arati opens
   with one full instrumental cycle of the same melody, so a chroma novelty
   curve cannot tell that cycle from a sung one; the first cut of this script
   read one and was wrong by 14.6 s, which the browser showed as the highlight
   running a line ahead of the voice for the whole recording. Folding the voice
   envelope at the period gives one stanza's shape — three troughs, one breath
   per line, the deepest being the gap between stanzas — and the stanza begins
   where it climbs back through its mean.

2. **The strophic head.** Chroma self-similarity gives the period, and each
   stanza is then matched against the one before it, at its own length. The
   match holds around 0.5-0.7 for five stanzas and collapses below 0.15 at the
   sixth. That collapse is the measurement: it is where the tempo breaks, and
   it lands within 0.02 s of the constant clock's own fifth boundary.

3. **The reprise.** The opening stanza's chroma, scaled over a range of tempi
   and slid along the rest of the recording, peaks a second time at 278.0 s —
   the runner-up match in the whole piece, and the reprise sings the opening's
   words again.

4. **The fast run.** The stanzas between the break and the reprise are placed
   by spacing them evenly and sliding the pair as one, taking the offset whose
   three segments are most alike. Three separate measurements agree on the
   answer: the fit likes 17.5 s, self-similarity *inside that stretch alone*
   peaks at 17.65 s, and two of the three boundaries land on a voice onset that
   the envelope found without being asked.

5. **The closing sections.** `jai bolo` and the mantra are not the bhajan and
   do not match its template at all, so they are found as structural
   boundaries — the sharpest changes in chroma after the reprise — and then
   snapped onto the nearest voice onset. Both are found twice over that way,
   which is the only reason they are trusted.

What none of this can tell you is which line inside a stanza is being sung
when. The web side spreads a stanza's lines evenly across its own span, which
is exact at every boundary and can be a second or so out in between. The
stanzas are sung for 85-99% of their span, the rest being the interlude, so a
slow stanza's last line lights slightly early. Bettering that needs an ear, and
the boundaries are what an ear notices.
"""

import re
import sys
from pathlib import Path

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

# Frames one stanza is resampled to before two stanzas are compared. Comparing
# at a fixed length is what lets a 17 s stanza be matched against a 36 s one.
BINS = 100

# Below this, a stanza no longer looks like the one before it and the strophic
# clock has broken. Well under the 0.4-0.7 the head holds and well over the
# 0.1-0.15 the fast run scores against a slow template.
MATCH_FLOOR = 0.30

# How far the breath channel counts against the twelve chroma ones. Enough to
# separate two segments that share a melody but not a phrasing.
BREATH_W = 0.35


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


def period(chroma, fps, lo=PERIOD_LO, hi=PERIOD_HI, trend_s=TREND_S):
    """The lag whose self-similarity stands highest off the local trend."""
    lags = np.arange(int(lo * fps), int(min(hi, len(chroma) / fps / 2) * fps))
    score = np.array([np.mean(np.sum(chroma[:-k] * chroma[k:], axis=1)) for k in lags])

    # Similarity falls away with lag whatever the structure, so a raw maximum
    # would only ever name the shortest lag searched. Compare each lag with its
    # own neighbourhood instead — and only where that neighbourhood is whole,
    # because a window running off the end of the array averages fewer values
    # and hands the lags at both edges a trend that is too low to beat.
    half = int(trend_s * fps)
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


def onsets(raw_env, fps):
    """
    Every moment the voice comes back after being down, and for how long.

    Deliberately over-detects — there are three times as many of these as there
    are stanzas, since a line's own breath looks much like a stanza's. They are
    not a cue sheet on their own; they are what a boundary found some other way
    is snapped onto, so that it lands on a voice and not between two.
    """

    def smooth(x, s):
        k = max(1, int(s * fps))
        return np.convolve(x, np.ones(k) / k, mode="same")

    # Against a slow-moving baseline rather than a fixed level, so the same
    # rule works through a quiet verse and a loud one.
    lift = smooth(raw_env, 0.45) - smooth(raw_env, 16.0)
    out = []
    down = None
    for i in range(len(lift)):
        if lift[i] < -1.0 and down is None:
            down = i
        elif down is not None and lift[i] > 0.5:
            out.append((i / fps, (i - down) / fps))
            down = None
    return out


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


# ---------------------------------------------------------------- the stanzas


def features(chroma, env, fps, vfps):
    """Chroma plus a breath channel, on one frame rate, for comparing stanzas."""
    n = len(chroma)
    at = np.clip((np.arange(n) / fps * vfps).astype(int), 0, len(env) - 1)
    breath = env[at]
    breath = (breath - breath.mean()) / (breath.std() + 1e-9)
    return np.concatenate([chroma, BREATH_W * breath[:, None]], axis=1)


def stanza(feat, fps, a, b):
    """
    A stanza's shape, resampled to a fixed length and normalised.

    The resampling is the point: two stanzas sung at different tempi are the
    same shape stretched, so comparing them at a fixed number of bins asks
    'is this the same music' without asking 'is it the same speed'.
    """
    i, j = int(a * fps), int(b * fps)
    if j > len(feat) or j - i < 8:
        return None
    x = np.linspace(i, j - 1, BINS)
    lo = np.floor(x).astype(int)
    hi = np.minimum(lo + 1, len(feat) - 1)
    frac = (x - lo)[:, None]
    s = feat[lo] * (1 - frac) + feat[hi] * frac
    s = s - s.mean(axis=0)
    return s / (np.linalg.norm(s) + 1e-9)


def track(feat, fps, lead, p, limit):
    """
    Walk the constant clock while each cycle still sounds like the opening.

    Returns the boundaries that held, and every score including the one that
    failed, so the margin either side of the floor is visible rather than
    asserted. On this recording those scores are 1.00, 0.72, 0.48, 0.44, 0.40
    and then 0.14 — a floor anywhere between 0.2 and 0.35 says the same thing.

    It is deliberately matched against the **opening**, at the **fixed**
    period, and both parts matter. Against the previous stanza it would follow
    a change instead of reporting one; at a searched length it does something
    worse, because a doubling in tempo means one cycle of the old length now
    holds two whole stanzas and matches itself well enough to pass. That is not
    hypothetical — it is what this function did first, and it swallowed the
    first fast stanza silently.
    """
    bounds = []
    scores = []
    t = lead
    while t + p <= limit:
        s = stanza(feat, fps, t, t + p)
        if s is None:
            break
        v = float((s * TMPL_OPENING).sum())
        scores.append(v)
        if v < MATCH_FLOOR:
            break
        bounds.append(t)
        t += p
    return bounds, scores


def find_reprise(feat, fps, opening, after, until):
    """
    Where the opening stanza is sung again, at whatever tempo it is sung at.

    Scale is searched as well as position because the reprise need not come
    back at the pace it left at — and if it is searched, the answer is not
    assumed either way.
    """
    best = (-9.0, None, None)
    for t in np.arange(after, until - 20.0, 0.25):
        for scale in np.arange(0.7, 1.35, 0.02):
            s = stanza(feat, fps, t, t + scale * opening)
            if s is None:
                continue
            v = float((s * TMPL_OPENING).sum())
            if v > best[0]:
                best = (v, t, scale * opening)
    return best


def fit_run(feat, fps, a, b, k, p, slack=16.0):
    """
    Place `k` equal stanzas between `a` and `b`: where they start, and how long.

    **Two free parameters, and the second one is not optional.** Deriving the
    length from the span — `(b - start) / k` — forces the run to reach `b`
    exactly, and a run of stanzas does not end where the next thing begins:
    there is an interlude in front of the reprise, as there is in front of most
    stanzas here. Forcing it cost 7 s, and it cost it in the worst possible
    way, by pushing the *start* late to make the arithmetic work. The verse
    was then highlighted most of a stanza after it was sung, which is what a
    listener notices first.

    The run is only required to reach within half a stanza of `b`, which is
    what says 'these are the stanzas before the reprise' without saying where
    the singing stops. The score is how alike the k segments are — the same
    question the tracker asks, put to a group.
    """
    best = (-9.0, None, None)
    for start in np.arange(a - 4.0, a + slack, 0.25):
        for d in np.arange(0.25 * p, 0.85 * p, 0.1):
            end = start + k * d
            if end > b + 1.0 or end < b - 0.5 * p:
                continue
            segs = [
                stanza(feat, fps, start + i * d, start + (i + 1) * d) for i in range(k)
            ]
            if any(s is None for s in segs):
                continue
            pairs = [
                float((segs[i] * segs[j]).sum())
                for i in range(k)
                for j in range(i + 1, k)
            ]
            v = float(np.mean(pairs))
            if v > best[0]:
                best = (v, start, d)
    v, start, d = best
    return [start + i * d for i in range(k)], d, v


def novelty(chroma, fps, window_s=14.0):
    """How unlike the next few seconds are to the last few. Finds section joins."""
    w = int(window_s * fps)
    nov = np.zeros(len(chroma))
    for i in range(w, len(chroma) - w):
        a = chroma[i - w : i].mean(axis=0)
        b = chroma[i : i + w].mean(axis=0)
        nov[i] = 1 - float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
    return nov


def sections(nov, fps, lo, hi, count, apart=10.0):
    """The `count` sharpest structural joins between `lo` and `hi`."""
    idx = np.where((np.arange(len(nov)) / fps > lo) & (np.arange(len(nov)) / fps < hi))[
        0
    ]
    picked = []
    for i in idx[np.argsort(nov[idx])[::-1]]:
        if all(abs(i - j) / fps > apart for j in picked):
            picked.append(i)
        if len(picked) == count:
            break
    return sorted(t / fps for t in picked), [nov[i] for i in sorted(picked)]


def snap(t, ons, sung_start, back=4.0, ahead=8.0, breath=2.0):
    """
    Move a boundary onto the voice that opens the stanza there.

    **Every cue goes through this, and the reprise is why.** Everything above
    is measured off harmony, and harmony cannot tell an instrumental statement
    of the melody from a sung one — the same fact that makes the phase of the
    whole recording unreadable from chroma. The reprise's template match is at
    278.0 s and its singing does not begin until 282.2, because the band plays
    the turn before the voices come back in. Four seconds is most of a line.

    So the harmonic anchor says *which* stanza and roughly where; the voice
    says exactly when. Taken forward from the anchor rather than nearest to
    it — nearest would happily pick the last breath of the stanza before — and
    only onsets that open after a real silence count, since a line's own breath
    inside a stanza is shorter than the gap between stanzas.
    """
    for o, gap in ons:
        if o < max(t - back, sung_start - 0.5) or o > t + ahead:
            continue
        if gap >= breath:
            return o, gap
    return t, None


# ------------------------------------------------------------------ the words

STANZA_END = re.compile(r"\s*/\s*[0-9०-९൦-൯]+\s*$")


def read_stanzas(path):
    """The same parse the browser does, so the count asserted here is its count."""
    out, current = [], []

    def close():
        nonlocal current
        if current:
            out.append(current)
        current = []

    for block in re.split(r"\n\s*\n", Path(path).read_text(encoding="utf-8")):
        line = re.sub(r"\s+", " ", block).strip()
        if not line:
            continue
        if re.fullmatch(r"-{3,}", line):
            close()
            continue
        current.append(STANZA_END.sub("", line))
        if STANZA_END.search(line):
            close()
    close()
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "docs/arati-master.webm"
    words = Path(__file__).resolve().parent.parent / "docs" / "arati-iast.md"
    stanzas = read_stanzas(words)

    # Which stanza is the reprise is a fact about the words, so it is read off
    # them rather than hunted for in the audio: it is the one that sings the
    # opening again. Everything after it is a closing section of its own.
    repeats = [i for i, s in enumerate(stanzas) if i > 0 and s == stanzas[0]]
    assert repeats, f"{words.name}: no stanza repeats the opening, so no reprise"
    reprise_at = repeats[0]
    tail = len(stanzas) - 1 - reprise_at
    print(
        f"{words.name}: {len(stanzas)} stanzas, reprise is stanza {reprise_at + 1}, "
        f"{tail} closing section(s) after it"
    )

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

    env, vfps = voice(sig)
    raw = env
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

    feat = features(chroma, env, fps, vfps)
    ons = onsets(raw, vfps)

    global TMPL_OPENING
    TMPL_OPENING = stanza(feat, fps, lead, lead + p)

    head, scores = track(feat, fps, lead, p, end)
    print(f"\nthe strophic clock holds for {len(head)} stanzas, matching the opening")
    print("  " + "  ".join(f"{v:.2f}" for v in scores) + f"   (floor {MATCH_FLOOR})")
    print(f"  it breaks at {head[-1] + p:.2f} s, where the tempo changes")
    assert len(head) < len(stanzas), (
        "every cycle matched the opening — the recording is strophic after all, "
        "and this script is now more machinery than the job needs"
    )

    rep_v, rep_t, rep_len = find_reprise(feat, fps, p, head[-1] + p, end)
    print(
        f"\nthe opening is sung again at {rep_t:.2f} s (match {rep_v:.3f}, "
        f"over {rep_len:.2f} s)"
    )

    fast_n = reprise_at - len(head)
    assert fast_n >= 1, "the reprise arrives before the tracker lost the clock"
    fast, fast_len, fast_v = fit_run(feat, fps, head[-1] + p, rep_t, fast_n, p)
    print(
        f"{fast_n} stanzas of {fast_len:.2f} s from {fast[0]:.2f} s (alike {fast_v:.3f})"
    )
    # The independent check on that fit, and the only one available: ask the
    # fast stretch on its own what period it repeats at, having told the fit
    # nothing. Agreeing to a fraction of a second is the whole reason these
    # numbers are trusted without an ear.
    run = chroma[int(fast[0] * fps) : int(rep_t * fps)]
    fp, *_ = period(run, fps, 6.0, min(30.0, len(run) / fps / 2.2), 3.0)
    print(f"  self-similarity inside that stretch alone peaks at {fp:.2f} s")

    nov = novelty(chroma, fps)
    cuts, strength = sections(nov, fps, rep_t + rep_len - 8.0, end - 8.0, tail)
    for t, s in zip(cuts, strength):
        print(f"  closing section at {t:.2f} s (novelty {s:.4f})")

    anchors = head + fast + [rep_t] + list(cuts)
    assert len(anchors) == len(stanzas), (
        f"measured {len(anchors)} stanza starts for {len(stanzas)} stanzas of words"
    )

    # Harmony says which stanza and roughly where; the voice says when. Every
    # anchor is measured against the voice, because that agreement is the
    # evidence — but only the ones that need it are moved.
    #
    # A head or fast-run anchor is a *periodic* estimate: one phase averaged
    # over every stanza in its run, so it is better than any single breath, and
    # the onsets wander a few tenths either side of it. Snapping those would
    # trade an exact number for a noisy one. The reprise and the closing
    # sections have no run to average over — each is one template match or one
    # novelty peak — and they are the ones the voice corrects, the reprise by a
    # full 8 s, because the band plays the turn before the singers come back.
    print("\n  the voice, against the harmony's anchor:")
    cues = []
    periodic = len(head) + len(fast)
    for i, a in enumerate(anchors):
        t, gap = snap(a, ons, start)
        keep = i < periodic
        cues.append(a if keep else t)
        print(
            f" {i + 1:2d}  {a:7.2f}  voice {t:7.2f}  {t - a:+5.2f} s   "
            f"{('kept, periodic' if keep else 'voice taken'):15s}"
            + (f"after {gap:.2f} s of silence" if gap else "no breath near it")
        )

    assert all(b > a for a, b in zip(cues, cues[1:])), "the cue sheet is not in order"

    print("\n  #  start      span   sung   of span   first line")
    for i, (t, s) in enumerate(zip(cues, stanzas)):
        nxt = cues[i + 1] if i + 1 < len(cues) else end
        j = int(nxt * vfps)
        lift = raw - np.convolve(
            raw, np.ones(int(16 * vfps)) / int(16 * vfps), mode="same"
        )
        while j > int(t * vfps) and lift[j] > -1.0:
            j -= 1
        while j > int(t * vfps) and lift[j] <= -1.0:
            j -= 1
        print(
            f" {i + 1:2d}  {t:7.2f}  {nxt - t:6.2f}  {j / vfps - t:5.2f}   "
            f"{(j / vfps - t) / (nxt - t):5.2f}   {s[0][:44]}"
        )
    print(f"  singing stops {end:.2f} s, recording ends {dur:.2f} s")

    print("\n--- src/components/arati-lyrics.ts ---")
    print("const CUES = [")
    for t, s in zip(cues, stanzas):
        print(f"  {t:.2f}, // {s[0][:46]}")
    print("];")
    print(f"const END_S = {end:.1f};")


if __name__ == "__main__":
    main()
