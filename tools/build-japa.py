#!/usr/bin/env python3
"""Build japa mode's mantra data from the sources in docs/japa/.

    python3 tools/build-japa.py

Writes static/data/japa/: one index.json holding the catalogue (ids, counts,
titles per script) and one {id}-{script}.json per mantra, so the page can show
the picker without downloading a thousand names it may never display.

The sources are scraped texts and are not uniform: lalita1000 wraps two long
names across lines and carries variant readings in parentheses, the namavalis
carry a count marker every tenth line, amma108 numbers each name, and the
scripts disagree about which om to use. Everything is normalised here so the
web side can treat every mantra identically.

Each mantra ends in an assert on its name count. That is the whole safety net:
a source edit that drops or merges a line fails the build rather than quietly
shortening the japa.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "japa")
OUT = os.path.join(ROOT, "static", "data", "japa")

# Script key used by the web side -> suffix used by the source filenames.
SCRIPTS = {"iast": "iast", "devanagari": "deva", "malayalam": "mal"}

OM = {"iast": "oṃ", "devanagari": "ॐ", "malayalam": "ഓം"}

# Every spelling of om that appears across the sources, longest first so the
# two-character Malayalam form is not half-matched by its own first letter.
ANY_OM = ("oṃ", "ഓം", "ओं", "ॐ")

DIGITS = "0-9०-९൦-൯"

# The trishati has no header line of its own: its source predates this tool and
# is a bare name list, shared with the browser-tab mantra.
TRISHATI = {
    "iast": ("śrī lalitā triśatī nāmāvaliḥ", "iast.txt"),
    "devanagari": ("श्री ललिता त्रिशती नामावलिः", "devanagari.txt"),
    "malayalam": ("ശ്രീ ലലിതാ ത്രിശതീ നാമാവലിഃ", "malayalam.txt"),
}

# Stripped off the front of a title: "atha" ("now begins") is a heading word,
# not part of the name anyone would pick from a list.
ATHA = ("atha", "अथ", "അഥ")

# Closing lines that follow the last name. Dedications rather than names, and
# matched from the r because sandhi swallows the a- of arpaṇam after ambā.
COLOPHON = ("rpaṇamastu", "र्पणमस्तु", "ര്പണമസ്തു")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def paragraphs(text):
    """Blank-line-separated blocks, each a list of non-empty lines."""
    out = []
    for block in re.split(r"\n\s*\n", text):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if lines:
            out.append(lines)
    return out


def dandas(s):
    """Normalise the ASCII stand-ins some sources use for ।/॥."""
    return s.replace("||", "॥").replace("|", "।")


def unbracket(s):
    """Drop variant readings. lalita1000 has one that wraps across two lines,
    hence the tolerance for an unclosed bracket."""
    return re.sub(r"\([^)]*\)?", "", s)


def normalise_om(s, script):
    for om in ANY_OM:
        if s.startswith(om + " ") or s.startswith(om):
            rest = s[len(om) :].lstrip()
            return f"{OM[script]} {rest}"
    return s


def clean_name(s, script):
    s = unbracket(dandas(s))
    s = re.sub(rf"[\s{DIGITS}]+$", "", s)  # the every-tenth count marker
    s = re.sub(r"[।॥\s]+$", "", s)  # namavali style: no closing danda
    s = re.sub(r"\s+", " ", s).strip()
    return normalise_om(s, script)


def clean_title(line):
    s = dandas(line).strip(" ॥।")
    for atha in ATHA:
        if s.startswith(atha + " "):
            s = s[len(atha) :].lstrip()
            break
        # The Sanskrit sources run it together: "athaśrīlalitā...".
        if s.startswith(atha) and not s.startswith(atha + " "):
            s = s[len(atha) :]
            break
    return re.sub(r"\s+", " ", s).strip()


def is_colophon(line):
    s = dandas(line)
    return s.startswith("॥") or any(w in s for w in COLOPHON)


def join_wraps(lines):
    """Rejoin names the source broke mid-compound. A continuation line is one
    that does not open with an om; it joins with no separator, because the
    break falls inside a single compound word."""
    out = []
    for line in lines:
        if out and not any(line.startswith(om) for om in ANY_OM):
            out[-1] += line.strip()
        else:
            out.append(line)
    return out


# ------------------------------------------------------------------ dhyanam


def lalita_dhyanam(script):
    """The Lalita dhyana verses, prefixed to every Lalita mantra."""
    blocks = paragraphs(read(os.path.join(SRC, f"lalita-dhyanam-{SCRIPTS[script]}.md")))
    label = blocks[0][0].strip(" ॥।")
    verses = ["\n".join(dandas(ln) for ln in block) for block in blocks[1:]]
    assert len(verses) == 4, f"lalita dhyanam {script}: {len(verses)} verses"
    return label, verses


# ------------------------------------------------------------------ mantras


def namavali(stem, script, expected, wrapped=False):
    """A name-per-line list under a ॥ title ॥."""
    text = read(os.path.join(SRC, f"{stem}-{SCRIPTS[script]}.md"))
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    title = clean_title(lines[0])
    body = [ln for ln in lines[1:] if not is_colophon(ln)]
    if wrapped:
        body = join_wraps(body)
    names = [n for n in (clean_name(ln, script) for ln in body) if n]
    assert len(names) == expected, (
        f"{stem} {script}: {len(names)} names, want {expected}"
    )
    return title, names


def trishati(script):
    title, filename = TRISHATI[script]
    text = read(os.path.join(ROOT, "static", "data", filename))
    names = [clean_name(ln, script) for ln in text.split("\n") if ln.strip()]
    assert len(names) == 300, f"trishati {script}: {len(names)} names"
    return title, names


def stotram(script):
    """Verses, not names: two lines apiece, numbered ॥ N॥ at the close."""
    blocks = paragraphs(read(os.path.join(SRC, f"stotram-{SCRIPTS[script]}.md")))
    title = clean_title(blocks[0][0])
    verses = []
    for block in blocks[1:]:
        if is_colophon(block[0]):
            continue
        lines = [unbracket(dandas(ln)).strip() for ln in block]
        # Only the closing number goes; the dandas are the verse's punctuation.
        lines[-1] = re.sub(rf"\s*॥\s*[{DIGITS}]+\s*॥\s*$", " ॥", lines[-1])
        lines[0] = normalise_om(lines[0], script)
        verses.append("\n".join(re.sub(r"\s+", " ", ln).strip() for ln in lines))
    assert len(verses) == 183, f"stotram {script}: {len(verses)} verses"
    return title, verses


def amma108(script):
    """Carries its own dhyanam, and numbers every name."""
    blocks = paragraphs(read(os.path.join(SRC, f"amma108-{SCRIPTS[script]}.md")))
    label = blocks[0][0].strip(" ॥।")
    dhyanam = ["\n".join(dandas(ln) for ln in blocks[1])]
    title = clean_title(blocks[2][0])
    names = []
    for block in blocks[3:]:
        for line in block:
            line = re.sub(rf"^[{DIGITS}]+\.\s*", "", line)
            names.append(clean_name(line, script))
    assert len(names) == 108, f"amma108 {script}: {len(names)} names"
    return label, dhyanam, title, names


# -------------------------------------------------------------------- build


def build():
    os.makedirs(OUT, exist_ok=True)
    catalogue = []

    lalita = [
        ("trishati", 300, trishati),
        ("lalita108", 108, lambda s: namavali("lalita108", s, 108)),
        ("lalita1000", 1000, lambda s: namavali("lalita1000", s, 1000, wrapped=True)),
        ("stotram", 183, stotram),
    ]

    for mantra_id, count, parse in lalita:
        titles = {}
        for script in SCRIPTS:
            label, dhyanam = lalita_dhyanam(script)
            title, names = parse(script)
            titles[script] = title
            write(mantra_id, script, title, label, dhyanam, names)
        catalogue.append({"id": mantra_id, "count": count, "title": titles})

    titles = {}
    for script in SCRIPTS:
        label, dhyanam, title, names = amma108(script)
        titles[script] = title
        write("amma108", script, title, label, dhyanam, names)
    catalogue.append({"id": "amma108", "count": 108, "title": titles})

    path = os.path.join(OUT, "index.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"mantras": catalogue}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"{os.path.relpath(path, ROOT)}: {len(catalogue)} mantras")


def write(mantra_id, script, title, label, dhyanam, names):
    path = os.path.join(OUT, f"{mantra_id}-{script}.json")
    data = {"title": title, "dhyanamLabel": label, "dhyanam": dhyanam, "names": names}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(
        f"{os.path.relpath(path, ROOT)}: {len(names)} names, {len(dhyanam)} dhyanam verses"
    )


if __name__ == "__main__":
    try:
        build()
    except AssertionError as err:
        sys.exit(f"build-japa: {err}")
