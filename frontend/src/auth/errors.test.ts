import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import en from '../i18n/locales/en.json'
import th from '../i18n/locales/th.json'
import { ApiError } from '../api/client'
import { KNOWN_ERROR_CODES, KNOWN_FIELD_CODES, errorMessage, fieldErrorMessage } from './errors'

const t = i18n.t.bind(i18n)

describe('error codes', () => {
  it('cover every code the backend can return (docs/openapi.yaml)', () => {
    const yaml = readFileSync(join(process.cwd(), '../docs/openapi.yaml'), 'utf8')
    const match = /enum:\s*\[(unauthorized[^\]]*)\]/.exec(yaml)
    expect(match, 'error code list not found in docs/openapi.yaml').not.toBeNull()
    const backendCodes = match![1]!.split(',').map((c) => c.trim())
    expect(backendCodes.length).toBeGreaterThan(5)

    // internal_error intentionally falls back to the generic message.
    const missing = backendCodes.filter(
      (c) => c !== 'internal_error' && !(KNOWN_ERROR_CODES as readonly string[]).includes(c),
    )
    expect(missing, `new backend error codes without a message: ${missing.join(', ')}`).toEqual([])
  })

  it('have a message in both languages', () => {
    for (const [lang, texts] of [
      ['en', en],
      ['th', th],
    ] as const) {
      for (const code of KNOWN_ERROR_CODES) {
        expect(code in texts.errors || code === 'network', `${lang} errors.${code}`).toBe(true)
      }
      for (const code of KNOWN_FIELD_CODES)
        expect(code in texts.fieldErrors, `${lang} fieldErrors.${code}`).toBe(true)
      expect(texts.errors.generic).toBeTruthy()
      expect(texts.fieldErrors.invalid).toBeTruthy()
    }
  })
})

describe('errorMessage()', () => {
  it('translates a known code', () => {
    expect(errorMessage(t, new ApiError(401, 'invalid_credentials', 'raw server text'))).toBe(
      'The email or password is incorrect.',
    )
  })

  it('never shows raw server text; unknown codes get the generic message', () => {
    const msg = errorMessage(t, new ApiError(500, 'something_new', 'SELECT * FROM secrets'))
    expect(msg).toBe(en.errors.generic)
    expect(msg).not.toContain('SELECT')
  })

  it('handles errors that are not ApiErrors', () => {
    expect(errorMessage(t, new Error('boom'))).toBe(en.errors.generic)
    expect(errorMessage(t, 'string')).toBe(en.errors.generic)
  })

  it('tells how long to wait on rate limiting (default 60 seconds)', () => {
    expect(errorMessage(t, new ApiError(429, 'rate_limited', 'x', {}, 42))).toContain('42')
    expect(errorMessage(t, new ApiError(429, 'rate_limited', 'x'))).toContain('60')
  })

  it('follows the current language', async () => {
    await i18n.changeLanguage('th')
    expect(errorMessage(i18n.t.bind(i18n), new ApiError(401, 'invalid_credentials', 'x'))).toBe(
      th.errors.invalid_credentials,
    )
  })
})

describe('fieldErrorMessage()', () => {
  it('translates field codes and falls back for unknown ones', () => {
    expect(fieldErrorMessage(t, 'invalid_email')).toBe(en.fieldErrors.invalid_email)
    expect(fieldErrorMessage(t, 'brand_new_code')).toBe(en.fieldErrors.invalid)
  })
})
