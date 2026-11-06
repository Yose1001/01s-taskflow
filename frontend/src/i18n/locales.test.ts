import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import th from './locales/th.json'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

const flatEn = flatten(en)
const flatTh = flatten(th)

// Words that are the same in both languages on purpose.
const SAME_IN_BOTH = new Set(['app.name', 'language.en', 'language.th'])
const THAI = /[฀-๿]/

describe('translations', () => {
  it('have exactly the same keys in Thai and English', () => {
    expect(Object.keys(flatTh).sort()).toEqual(Object.keys(flatEn).sort())
  })

  it('have no empty text', () => {
    for (const [key, value] of [...Object.entries(flatEn), ...Object.entries(flatTh)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('are really translated: Thai text contains Thai letters, English text does not', () => {
    for (const [key, value] of Object.entries(flatTh)) {
      if (SAME_IN_BOTH.has(key)) continue
      expect(THAI.test(value), `th ${key} = "${value}" has no Thai letters (not translated?)`).toBe(
        true,
      )
    }
    for (const [key, value] of Object.entries(flatEn)) {
      if (SAME_IN_BOTH.has(key)) continue
      expect(THAI.test(value), `en ${key} = "${value}" contains Thai letters`).toBe(false)
    }
  })

  it('use the same {{placeholders}} in both languages', () => {
    const placeholders = (s: string) =>
      [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(flatEn)) {
      expect(placeholders(flatTh[key] ?? ''), key).toEqual(placeholders(flatEn[key]!))
    }
  })

  it('cover every fixed key used in the source code', () => {
    // Finds t('some.key') in src; keys built at runtime (t(`status.${x}`)) are covered by the checks above.
    const srcDir = join(process.cwd(), 'src') + '/'
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) files.push(path)
      }
    }
    walk(srcDir)

    const missing: string[] = []
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!(m[1]! in flatEn)) missing.push(`${m[1]} (in ${file.replace(srcDir, 'src/')})`)
      }
    }
    expect(missing).toEqual([])
  })
})
