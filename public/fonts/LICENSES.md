# Font licenses

Only OFL-1.1 or Apache-2.0 fonts may be added to this folder. Every font file must be listed here,
with its full license text in `licenses/`. Fonts are redistributed unmodified.

| File | Family | License | Source |
| ---- | ------ | ------- | ------ |
| `Caveat-Variable.ttf` | Caveat | [OFL-1.1](licenses/Caveat-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/caveat |
| `PlaypenSans-Variable.ttf` | Playpen Sans | [OFL-1.1](licenses/PlaypenSans-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/playpensans |
| `BadScript-Regular.ttf` | Bad Script | [OFL-1.1](licenses/BadScript-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/badscript |
| `Pacifico-Regular.ttf` | Pacifico | [OFL-1.1](licenses/Pacifico-OFL.txt) | https://github.com/google/fonts/tree/main/ofl/pacifico |

## Coverage notes

Caveat, Bad Script and Pacifico have no glyph for U+02BB (ʻ, as in oʻ gʻ). The renderer falls back to
U+2018 (‘), which these fonts do have — see `SUBSTITUTES` in `src/core/render/glyphs.ts`.
Playpen Sans covers U+02BB natively.
