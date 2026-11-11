import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Pastel colors are easy to make unreadable. This test reads the REAL palette from index.css and checks
// every text/background pair we use against the WCAG AA minimum contrast for normal text (4.5:1).

// Tests always run from the frontend folder (pnpm test), so paths are relative to it.
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

// Finds a CSS rule by its selector at the START of a line (so a mention of the same text inside another
// rule, like @custom-variant, cannot be mistaken for it) and returns the --color: #hex values inside.
function block(selectorPattern: RegExp): Record<string, string> {
  const match = selectorPattern.exec(css)
  if (!match) throw new Error(`CSS block not found: ${selectorPattern}`)
  const open = match.index + match[0].length - 1 // the "{" that ends the pattern
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const tokens: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]!] = m[2]!
  return tokens
}

const themes = {
  light: block(/^:root,\s*\[data-theme='light'\]\s*\{/m),
  dark: block(/^\[data-theme='dark'\]\s*\{/m),
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// [text color, background it is drawn on]: every combination the components use.
const PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-2'],
  ['on-primary', 'primary'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary-fg', 'surface'],
  ['primary-fg', 'primary-bg'],
  ['pink-fg', 'pink-bg'],
  ['mint-fg', 'mint-bg'],
  ['sky-fg', 'sky-bg'],
  ['peach-fg', 'peach-bg'],
  ['lemon-fg', 'lemon-bg'],
  ['danger-fg', 'danger-bg'],
  ['on-danger', 'danger'],
  ['danger', 'surface'],
  ['danger', 'surface-2'],
  ['danger', 'bg'],
  ['bg', 'text'], // the Undo bar: colors reversed
]

// Controls that are not text (WCAG 1.4.11) need 3:1 against what they sit on.
const CONTROL_PAIRS: [string, string][] = [
  ['handle', 'surface'],
  // The colored page pictures in the top bar: Calendar and the bell, plain and when hovered or open.
  ['sky-fg', 'surface'],
  ['sky-fg', 'primary-bg'],
  ['peach-fg', 'surface'],
  ['peach-fg', 'primary-bg'],
]

describe('palette', () => {
  it('defines exactly the same color names in light and dark', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort())
    expect(Object.keys(themes.light).length).toBeGreaterThan(15)
  })

  it('really reads two DIFFERENT palettes: a light one and a dark one', () => {
    // Guards against the test silently reading the same block twice.
    expect(themes.light['bg']).not.toBe(themes.dark['bg'])
    expect(luminance(themes.light['bg']!)).toBeGreaterThan(0.8)
    expect(luminance(themes.dark['bg']!)).toBeLessThan(0.05)
    expect(luminance(themes.light['text']!)).toBeLessThan(luminance(themes.light['bg']!))
    expect(luminance(themes.dark['text']!)).toBeGreaterThan(luminance(themes.dark['bg']!))
  })

  for (const [name, tokens] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      for (const [fg, bg] of PAIRS) {
        it(`${fg} on ${bg} is readable (>= 4.5:1)`, () => {
          expect(tokens[fg], `missing token ${fg}`).toBeDefined()
          expect(tokens[bg], `missing token ${bg}`).toBeDefined()
          const ratio = contrast(tokens[fg]!, tokens[bg]!)
          expect(
            ratio,
            `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5)
        })
      }
      for (const [fg, bg] of CONTROL_PAIRS) {
        it(`${fg} on ${bg} is visible (>= 3:1)`, () => {
          expect(tokens[fg], `missing token ${fg}`).toBeDefined()
          expect(tokens[bg], `missing token ${bg}`).toBeDefined()
          const ratio = contrast(tokens[fg]!, tokens[bg]!)
          expect(
            ratio,
            `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(3)
        })
      }
    })
  }

  it('contrast helper is correct (black on white is 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5) // a known failing grey
  })
})
