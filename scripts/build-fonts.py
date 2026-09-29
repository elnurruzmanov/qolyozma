"""Build public/fonts/*.woff2 from the pristine OFL fonts in fonts-src/*.ttf.

Run with:  npm run build:fonts   (uv run --no-project --with fonttools[woff]==4.66.0 python scripts/build-fonts.py)

Fonts in STATIC_INSTANCES are first pinned to a static instance at every axis default with
fontTools.varLib.instancer: the renderer draws the default instance only and varies weight with stroke width,
so the variation data is dead weight. The output is renamed `*-Variable` -> `*-Regular`.

Fixes applied only where a font needs them; every change is printed and must be listed in
public/fonts/LICENSES.md:

1. Uzbek modifier letters: map U+02BB (ʻ) / U+02BC (ʼ) to the U+2018 / U+2019 glyph when missing.
2. Apostrophe spacing: glyphs for ʻ ʼ ‘ ’ get a tight, symmetric side bearing when the source glyph
   has a large left bearing or ink that overflows its advance (renders as "ma ʼno").
2b. Slanted fonts: shorten the advance of those glyphs when the gap to the next ascender at the
   mark's height exceeds APOSTROPHE_MAX_GAP (Bad Script, Caveat: "Bogʻ larda").
3. Missing breve: rebuild Ў / ў as base (У / у) + breve when the source glyph has no breve.
4. opentype.js compatibility: unhook `ccmp` features whose chaining lookups opentype.js can't run.

Then every font is subset to UNICODE_RANGES (Latin, Latin-ext, Cyrillic incl. Uzbek, punctuation),
hinting dropped (we render outlines ourselves), and written as WOFF2.

None of the fonts declares a Reserved Font Name, so modified versions keep their family names (OFL-1.1 §3).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent
from fontTools.pens.basePen import BasePen
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "fonts-src"
OUT = ROOT / "public" / "fonts"

# Variable fonts shipped as a static instance at their axis defaults.
STATIC_INSTANCES = {"PlaypenSans-Variable.ttf", "ShantellSans-Variable.ttf"}

# Inclusive code point ranges kept in the subset.
UNICODE_RANGES = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1 Supplement
    (0x0100, 0x024F),  # Latin Extended-A, -B
    (0x0250, 0x02FF),  # IPA extensions, spacing modifier letters (ʻ ʼ ˘ ˆ ...)
    (0x0300, 0x036F),  # combining diacritics (decomposed input: o + U+0306 ...)
    (0x0400, 0x052F),  # Cyrillic, Cyrillic Supplement (Ў Ғ Қ Ҳ and friends)
    (0x1E00, 0x1EFF),  # Latin Extended Additional
    (0x2000, 0x206F),  # General Punctuation (– — ‘ ’ “ ” „ … • ‰ ‹ ›)
    (0x20A0, 0x20CF),  # currency (€ ₽ ₸ ...)
    (0x2116, 0x2116),  # №
    (0x2122, 0x2122),  # ™
    (0x2212, 0x2212),  # minus
]

MODIFIER_FALLBACKS = {0x02BB: 0x2018, 0x02BC: 0x2019}
APOSTROPHES = (0x02BB, 0x02BC, 0x2018, 0x2019)
APOSTROPHE_SIDE = 0.04  # em
BREVE_PAIRS = {0x040E: 0x0423, 0x045E: 0x0443}  # Ў <- У, ў <- у
BREVE_GAP = 0.05  # em between base top and breve bottom
APOSTROPHE_MAX_GAP = 0.12  # em, gap from ʻ ʼ ‘ ’ to the next ascender ("l") at the mark's height
APOSTROPHE_MIN_GAP = 0.04  # em, minimum clearance to any neighbour ink at the mark's height
GAP_PREVIOUS = "ogOG"  # oʻ gʻ Oʻ Gʻ: the mark must not collide with the letter it modifies
GAP_NEXT = "lazonrmbdhkt"  # letters that commonly follow them


def bounds(font: TTFont, name: str) -> tuple[int, int, int, int]:
    glyf = font["glyf"]
    g = glyf[name]
    g.recalcBounds(glyf)
    if not hasattr(g, "xMin"):  # empty glyph
        return (0, 0, 0, 0)
    return (g.xMin, g.yMin, g.xMax, g.yMax)


def add_cmap(font: TTFont, cp: int, glyph_name: str) -> None:
    for table in font["cmap"].tables:
        if table.isUnicode() and (table.format != 4 or cp <= 0xFFFF):
            table.cmap[cp] = glyph_name


def fix_modifier_letters(font: TTFont, log: list[str]) -> None:
    cmap = font.getBestCmap()
    for cp, fallback in MODIFIER_FALLBACKS.items():
        if cp not in cmap and fallback in cmap:
            add_cmap(font, cp, cmap[fallback])
            log.append(f"mapped U+{cp:04X} to the U+{fallback:04X} glyph")


def fix_apostrophe_spacing(font: TTFont, log: list[str]) -> None:
    upm = font["head"].unitsPerEm
    side = round(APOSTROPHE_SIDE * upm)
    cmap = font.getBestCmap()
    glyf, hmtx = font["glyf"], font["hmtx"]
    for name in dict.fromkeys(cmap[cp] for cp in APOSTROPHES if cp in cmap):
        adv, _ = hmtx[name]
        x_min, _, x_max, _ = bounds(font, name)
        if x_max <= x_min:
            continue
        if x_min <= 2 * side and x_max <= adv:
            continue  # already reasonable
        dx = side - x_min
        g = glyf[name]
        if g.isComposite():
            for c in g.components:
                c.x += dx
        else:
            g.coordinates.translate((dx, 0))
        new_adv = (x_max - x_min) + 2 * side
        hmtx[name] = (new_adv, side)
        g.recalcBounds(glyf)
        log.append(f"{name}: advance {adv} -> {new_adv}, left bearing {x_min} -> {side}")


class _FlattenPen(BasePen):
    """Collects points along the outline (curves sampled), for measuring ink at a given height."""

    STEPS = 16

    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.points: list[tuple[float, float]] = []

    def _moveTo(self, pt):
        self.points.append(pt)

    def _lineTo(self, pt):
        self.points.append(pt)

    def _qCurveToOne(self, pt1, pt2):
        (x0, y0), (x1, y1), (x2, y2) = self._getCurrentPoint(), pt1, pt2
        for i in range(1, self.STEPS + 1):
            t = i / self.STEPS
            u = 1 - t
            self.points.append((u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2))

    def _curveToOne(self, pt1, pt2, pt3):
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = self._getCurrentPoint(), pt1, pt2, pt3
        for i in range(1, self.STEPS + 1):
            t = i / self.STEPS
            u = 1 - t
            self.points.append((
                u**3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x3,
                u**3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y3,
            ))


def outline_points(font: TTFont, name: str) -> list[tuple[float, float]]:
    glyph_set = font.getGlyphSet()
    pen = _FlattenPen(glyph_set)
    glyph_set[name].draw(pen)
    return pen.points


def fix_gap_after_apostrophe(font: TTFont, log: list[str]) -> None:
    """Fit ʻ ʼ ‘ ’ between their neighbours at the mark's own height.

    In slanted fonts the next letter's ascender leans away from the mark ("Bogʻ larda") and the previous
    letter's ascender leans into it ("qalʼa" hides the mark). Using ink measured inside the mark's vertical band:
    - left: keep at least APOSTROPHE_MIN_GAP from the previous letters' ink (widen the left bearing if not);
    - right: shorten the advance until the gap to "l" is at most APOSTROPHE_MAX_GAP, but never below
      APOSTROPHE_MIN_GAP to any following letter that has ink at that height.
    """
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyf, hmtx = font["glyf"], font["hmtx"]
    min_gap, max_gap = APOSTROPHE_MIN_GAP * upm, APOSTROPHE_MAX_GAP * upm
    neighbour = {ch: outline_points(font, cmap[ord(ch)]) for ch in set(GAP_PREVIOUS + GAP_NEXT) if ord(ch) in cmap}

    def band_x(ch: str, y_lo: float, y_hi: float) -> list[float]:
        return [x for x, y in neighbour.get(ch, []) if y_lo <= y <= y_hi]

    for name in dict.fromkeys(cmap[cp] for cp in APOSTROPHES if cp in cmap):
        pts = outline_points(font, name)
        if not pts:
            continue
        y_lo, y_hi = min(p[1] for p in pts), max(p[1] for p in pts)
        adv, lsb = hmtx[name]
        ink_left, ink_right = min(p[0] for p in pts), max(p[0] for p in pts)
        changes = []

        # Left: previous letter's ink in the band may reach past its advance (slanted ascenders).
        overhang = max(
            (max(xs) - hmtx[cmap[ord(ch)]][0] for ch in GAP_PREVIOUS if (xs := band_x(ch, y_lo, y_hi))),
            default=-math.inf,
        )
        shift = round(overhang + min_gap - ink_left)
        if shift > 0:
            g = glyf[name]
            if g.isComposite():
                for c in g.components:
                    c.x += shift
            else:
                g.coordinates.translate((shift, 0))
            g.recalcBounds(glyf)
            ink_left, ink_right, adv = ink_left + shift, ink_right + shift, adv + shift
            changes.append(f"left bearing +{shift} (previous ascender overhangs by {overhang:.0f})")

        # Right: next letter drawn at `adv`; its coordinates include its own left bearing.
        gaps = {ch: adv + min(xs) - ink_right for ch in GAP_NEXT if (xs := band_x(ch, y_lo, y_hi))}
        reduce = 0
        if "l" in gaps and gaps["l"] > max_gap:
            reduce = round(min(gaps["l"] - max_gap, min(gaps.values()) - min_gap))
        if reduce > 0:
            adv -= reduce
            changes.append(f"advance -{reduce} (gap to 'l' {gaps['l']:.0f} -> {gaps['l'] - reduce:.0f})")

        if changes:
            hmtx[name] = (adv, round(glyf[name].xMin))
            log.append(f"{name}: " + "; ".join(changes))


def find_breve(font: TTFont) -> str | None:
    cmap = font.getBestCmap()
    if 0x02D8 in cmap:
        return cmap[0x02D8]
    return "breve" if "breve" in font.getGlyphOrder() else None


def fix_missing_breve(font: TTFont, log: list[str]) -> None:
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    breve = find_breve(font)
    glyf, hmtx = font["glyf"], font["hmtx"]
    for target_cp, base_cp in BREVE_PAIRS.items():
        if target_cp not in cmap or base_cp not in cmap:
            continue
        target, base = cmap[target_cp], cmap[base_cp]
        _, _, _, target_top = bounds(font, target)
        bx0, _, bx1, base_top = bounds(font, base)
        if target_top > base_top + 0.05 * upm:
            continue  # has something above the base: breve present
        if breve is None:
            log.append(f"WARNING {target}: no breve and no breve glyph to build one")
            continue
        rx0, ry0, rx1, _ = bounds(font, breve)
        dx = round((bx0 + bx1) / 2 - (rx0 + rx1) / 2)
        dy = round(base_top + BREVE_GAP * upm - ry0)

        g = Glyph()
        g.numberOfContours = -1
        g.components = []
        for name, x, y in ((base, 0, 0), (breve, dx, dy)):
            c = GlyphComponent()
            c.glyphName, c.x, c.y, c.flags = name, x, y, 0
            g.components.append(c)
        g.components[0].flags = 0x0200  # USE_MY_METRICS
        glyf[target] = g
        g.recalcBounds(glyf)
        hmtx[target] = (hmtx[base][0], g.xMin)
        if "gvar" in font and target in font["gvar"].variations:
            font["gvar"].variations[target] = []  # old point deltas don't fit the new composite
        log.append(f"{target}: rebuilt as {base} + {breve}")


def drop_unsupported_ccmp(font: TTFont, log: list[str]) -> None:
    """opentype.js runs `ccmp` on every string but can't execute chaining-context lookups in
    format 1/2 and throws. Our input is precomposed Unicode, so ccmp isn't needed: drop it."""
    if "GSUB" not in font:
        return
    gsub = font["GSUB"].table
    if not gsub.FeatureList:
        return
    lookups = gsub.LookupList.Lookup

    def unsupported(index: int) -> bool:
        lk = lookups[index]
        return any(
            lk.LookupType in (5, 6) and getattr(st, "Format", 3) != 3
            or lk.LookupType == 7 and st.ExtSubTable.LookupType in (5, 6) and st.ExtSubTable.Format != 3
            for st in lk.SubTable
        )

    bad = {
        i
        for i, rec in enumerate(gsub.FeatureList.FeatureRecord)
        if rec.FeatureTag == "ccmp" and any(unsupported(li) for li in rec.Feature.LookupListIndex)
    }
    if not bad:
        return
    scripts = gsub.ScriptList.ScriptRecord if gsub.ScriptList else []
    for sr in scripts:
        langs = [sr.Script.DefaultLangSys] + [l.LangSys for l in sr.Script.LangSysRecord]
        for ls in filter(None, langs):
            ls.FeatureIndex = [fi for fi in ls.FeatureIndex if fi not in bad]
            ls.FeatureCount = len(ls.FeatureIndex)
    log.append(f"GSUB: disabled {len(bad)} ccmp feature record(s) with chaining lookups opentype.js can't run")


def stamp_version(font: TTFont) -> None:
    note = "; modified by Qolyozma build-fonts (see LICENSES.md)"
    for rec in font["name"].names:
        if rec.nameID == 5 and note not in rec.toUnicode():
            rec.string = rec.toUnicode() + note


def subset_to_ranges(font: TTFont) -> None:
    options = subset.Options()
    options.layout_features = ["*"]  # keep every OpenType feature for the glyphs we keep
    options.name_IDs = ["*"]  # keep copyright / license / version records (OFL)
    options.name_languages = ["*"]
    options.name_legacy = True
    options.hinting = False  # outlines are rendered by opentype.js, hints are never used
    options.notdef_outline = True
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[cp for lo, hi in UNICODE_RANGES for cp in range(lo, hi + 1)])
    subsetter.subset(font)


def pin_to_default_instance(font: TTFont, log: list[str]) -> TTFont:
    axes = font["fvar"].axes
    static = instancer.instantiateVariableFont(font, {a.axisTag: None for a in axes})  # None = axis default
    log.append("static instance at " + ", ".join(f"{a.axisTag}={a.defaultValue:g}" for a in axes))
    return static


def output_name(src: Path) -> str:
    stem = src.stem.replace("-Variable", "-Regular") if src.name in STATIC_INSTANCES else src.stem
    return f"{stem}.woff2"


def build(src: Path) -> tuple[Path, list[str]]:
    font = TTFont(src, recalcTimestamp=False)  # reproducible output: keep the source timestamp
    log: list[str] = []
    if src.name in STATIC_INSTANCES:
        font = pin_to_default_instance(font, log)
    fix_modifier_letters(font, log)
    fix_apostrophe_spacing(font, log)
    fix_gap_after_apostrophe(font, log)
    fix_missing_breve(font, log)
    drop_unsupported_ccmp(font, log)
    glyphs_before = len(font.getGlyphOrder())
    subset_to_ranges(font)
    log.append(f"subset: {glyphs_before} -> {len(font.getGlyphOrder())} glyphs, hinting dropped, WOFF2")
    stamp_version(font)
    out = OUT / output_name(src)
    font.flavor = "woff2"
    font.save(out)
    return out, log


def kb(n: int) -> str:
    return f"{n / 1024:,.0f} KB"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for src in sorted(SRC.glob("*.ttf")):
        out, log = build(src)
        print(f"{src.name} -> {out.name}")
        for line in log:
            print(f"  - {line}")
        rows.append((out.name, src.stat().st_size, out.stat().st_size))

    print(f"\n{'font':<32}{'source TTF':>12}{'WOFF2':>10}{'saved':>8}")
    for name, before, after in rows:
        print(f"{name:<32}{kb(before):>12}{kb(after):>10}{1 - after / before:>8.0%}")
    total_before = sum(r[1] for r in rows)
    total_after = sum(r[2] for r in rows)
    print(f"{'total':<32}{kb(total_before):>12}{kb(total_after):>10}{1 - total_after / total_before:>8.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
