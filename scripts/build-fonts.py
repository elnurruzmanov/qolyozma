"""Build public/fonts from the pristine OFL fonts in fonts-src.

Run with:  npm run build:fonts   (uv run --no-project --with fonttools==4.66.0 python scripts/build-fonts.py)

Fixes applied only where a font needs them; every change is printed and must be listed in
public/fonts/LICENSES.md:

1. Uzbek modifier letters: map U+02BB (ʻ) / U+02BC (ʼ) to the U+2018 / U+2019 glyph when missing.
2. Apostrophe spacing: glyphs for ʻ ʼ ‘ ’ get a tight, symmetric side bearing when the source glyph
   has a large left bearing or ink that overflows its advance (renders as "ma ʼno").
3. Missing breve: rebuild Ў / ў as base (У / у) + breve when the source glyph has no breve.
4. opentype.js compatibility: unhook `ccmp` features whose chaining lookups opentype.js can't run.

None of the fonts declares a Reserved Font Name, so modified versions keep their family names (OFL-1.1 §3).
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "fonts-src"
OUT = ROOT / "public" / "fonts"

MODIFIER_FALLBACKS = {0x02BB: 0x2018, 0x02BC: 0x2019}
APOSTROPHES = (0x02BB, 0x02BC, 0x2018, 0x2019)
APOSTROPHE_SIDE = 0.04  # em
BREVE_PAIRS = {0x040E: 0x0423, 0x045E: 0x0443}  # Ў <- У, ў <- у
BREVE_GAP = 0.05  # em between base top and breve bottom


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


def stamp_version(font: TTFont, log: list[str]) -> None:
    if not log:
        return
    note = "; modified by Qolyozma build-fonts (see LICENSES.md)"
    for rec in font["name"].names:
        if rec.nameID == 5 and note not in rec.toUnicode():
            rec.string = rec.toUnicode() + note


def build(src: Path) -> list[str]:
    font = TTFont(src)
    log: list[str] = []
    fix_modifier_letters(font, log)
    fix_apostrophe_spacing(font, log)
    fix_missing_breve(font, log)
    drop_unsupported_ccmp(font, log)
    stamp_version(font, log)
    font.save(OUT / src.name)
    return log


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for src in sorted(SRC.glob("*.ttf")):
        log = build(src)
        print(f"{src.name}: {'unchanged' if not log else ''}")
        for line in log:
            print(f"  - {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
