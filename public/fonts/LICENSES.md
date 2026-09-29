# Font licenses

Only OFL-1.1 or Apache-2.0 fonts may be added to this folder. Every font file must be listed here,
with its full license text in `licenses/`.

The files here are WOFF2 files built from the unmodified TTF originals in `fonts-src/` by `scripts/build-fonts.py`
(`npm run build:fonts`). None of these fonts declares a Reserved Font Name, so the modified versions keep
their names (OFL-1.1 §3); their version string notes the modification.

| File | Family | License | Source | Modified |
| ---- | ------ | ------- | ------ | -------- |
| `Caveat-Variable.woff2` | Caveat | [OFL-1.1](licenses/Caveat-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/caveat | yes |
| `ShantellSans-Regular.woff2` | Shantell Sans | [OFL-1.1](licenses/ShantellSans-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/shantellsans | yes |
| `PlaypenSans-Regular.woff2` | Playpen Sans | [OFL-1.1](licenses/PlaypenSans-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/playpensans | yes |
| `BadScript-Regular.woff2` | Bad Script | [OFL-1.1](licenses/BadScript-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/badscript | yes |
| `Pacifico-Regular.woff2` | Pacifico | [OFL-1.1](licenses/Pacifico-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/pacifico | yes |

## Modifications

- **Playpen Sans, Shantell Sans:** variable fonts pinned to a static instance at their axis defaults
  (Playpen Sans wght 400; Shantell Sans wght 300, INFM 0, BNCE 0, SPAC 0) with fontTools.varLib.instancer;
  files renamed `-Variable` -> `-Regular`.
- **All fonts:** subset to Latin, Latin Extended, Cyrillic (incl. Uzbek letters), combining marks and
  punctuation (see `UNICODE_RANGES` in the build script); hinting removed; converted to WOFF2.
- **Caveat, Shantell Sans, Bad Script, Pacifico:** U+02BB (ʻ, as in oʻ gʻ) added to the character map,
  pointing at the font's own U+2018 (‘) glyph.
- **Caveat, Shantell Sans, Bad Script, Pacifico:** side bearings of the ʻ ʼ ‘ ’ glyphs normalised to 0.04 em
  on each side. The originals had large left bearings or ink overflowing the advance, which drew as "ma ʼno".
- **Caveat, Bad Script** (slanted), and slightly Pacifico, Playpen Sans, Shantell Sans: the ʻ ʼ ‘ ’ glyphs are
  fitted between their neighbours at the mark’s own height — advance shortened so the next ascender is at most
  0.12 em away ("Bogʻ larda"), left bearing widened where a slanted O/G would cover the mark.
- **Bad Script:** Ў (U+040E) had no breve in the original outline; rebuilt as У + breve.
- **Shantell Sans:** the `ccmp` feature is unhooked from the script list (its chaining lookups can't be run
  by opentype.js and made every string fail to shape). Text is precomposed Unicode, so nothing is lost.
