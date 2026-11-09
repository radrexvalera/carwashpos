import { Font } from '@react-pdf/renderer'
// Helvetica (a built-in PDF standard font) has no glyph for the peso sign (U+20B1) -- it silently
// fell back to a substitute glyph (rendered as "±") instead. Switched to Noto Sans, but the first
// attempt at this (Google Fonts' pre-subset "latin-ext" files) made it WORSE: latin-ext and latin
// are disjoint subsets, not nested, so latin-ext has the peso sign but is missing basic digits,
// letters and punctuation entirely -- verified directly against the font files, not assumed. Using
// the full (unsubsetted) variable font instead guarantees nothing is missing; confirmed it covers
// everything from A-Z/0-9/punctuation through the peso sign before switching to it.
//
// Registered at both 400 and 700 purely so a fontWeight: 'bold' style resolves to a real font
// entry instead of erroring -- react-pdf embeds whatever instance fontkit resolves by default from
// a variable font (it doesn't request a specific wght axis value), so "bold" text won't actually
// look bolder than regular. A real cosmetic shortcoming, but correctness (every character actually
// rendering) matters far more than that.
import notoSansUrl from '@/assets/fonts/NotoSans.ttf?url'

Font.register({
  family: 'Noto Sans',
  fonts: [
    { src: notoSansUrl, fontWeight: 400 },
    { src: notoSansUrl, fontWeight: 700 },
  ],
})

// fontkit caches each glyph object by id the first time it's requested, together with whatever
// code points that first caller passed. Some of its internal callers (e.g. building the embedded
// font subset when a PDF is written) request glyphs with NO code points, and from then on every
// layout of that glyph gets the cached object with an empty codePoints list. react-pdf maps glyphs
// back to characters via codePoints, so an empty list shifts the mapping by one and the leading
// characters of the string get sliced off -- a payslip total of ₱5,417.60 printed as "417.60".
// Because the cache lives as long as the page, it only bit after earlier payslips had been
// generated in the same tab, which is why it looked random. Reproduced and confirmed by rendering
// a series of payslips in one process. Backfilling the code points when a cached glyph comes back
// without them fixes the mapping; getGlyph(id, codePoints) and glyph.codePoints are both fontkit's
// documented public API.
interface FontkitGlyph {
  codePoints: number[]
}
interface FontkitFont {
  getGlyph: (id: number, codePoints?: number[]) => FontkitGlyph | null
  __codePointsPatched?: boolean
}

// Call before every pdf() render of a payslip: loads both registered weights and patches them.
export async function preparePayslipPdfFonts() {
  for (const fontWeight of [400, 700]) {
    await Font.load({ fontFamily: 'Noto Sans', fontWeight })
    const source = Font.getFont({ fontFamily: 'Noto Sans', fontWeight }) as unknown as { data?: FontkitFont } | null
    const font = source?.data
    if (!font || font.__codePointsPatched) continue
    const getGlyph = font.getGlyph.bind(font)
    font.getGlyph = (id, codePoints = []) => {
      const glyph = getGlyph(id, codePoints)
      if (glyph && codePoints.length > 0 && glyph.codePoints.length === 0) glyph.codePoints = codePoints
      return glyph
    }
    font.__codePointsPatched = true
  }
}
