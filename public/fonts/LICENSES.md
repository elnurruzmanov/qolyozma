# Font licenses

Only OFL-1.1 or Apache-2.0 fonts may be added to this folder. Every font file must be listed here,
with its full license text in `licenses/`.

The files here are built from the unmodified originals in `fonts-src/` by `scripts/build-fonts.py`
(`npm run build:fonts`). None of these fonts declares a Reserved Font Name, so the modified versions keep
their names (OFL-1.1 §3); their version string notes the modification.

| File | Family | License | Source | Modified |
| ---- | ------ | ------- | ------ | -------- |
| `Caveat-Variable.ttf` | Caveat | [OFL-1.1](licenses/Caveat-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/caveat | yes |
| `ShantellSans-Variable.ttf` | Shantell Sans | [OFL-1.1](licenses/ShantellSans-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/shantellsans | yes |
| `PlaypenSans-Variable.ttf` | Playpen Sans | [OFL-1.1](licenses/PlaypenSans-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/playpensans | no |
| `BadScript-Regular.ttf` | Bad Script | [OFL-1.1](licenses/BadScript-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/badscript | yes |
| `Pacifico-Regular.ttf` | Pacifico | [OFL-1.1](licenses/Pacifico-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/pacifico | yes |

## Modifications

- **Caveat, Shantell Sans, Bad Script, Pacifico:** U+02BB (ʻ, as in oʻ gʻ) added to the character map,
  pointing at the font's own U+2018 (‘) glyph.
- **Caveat, Shantell Sans, Bad Script, Pacifico:** side bearings of the ʻ ʼ ‘ ’ glyphs normalised to 0.04 em
  on each side. The originals had large left bearings or ink overflowing the advance, which drew as "ma ʼno".
- **Bad Script:** Ў (U+040E) had no breve in the original outline; rebuilt as У + breve.
- **Shantell Sans:** the `ccmp` feature is unhooked from the script list (its chaining lookups can't be run
  by opentype.js and made every string fail to shape). Text is precomposed Unicode, so nothing is lost.
