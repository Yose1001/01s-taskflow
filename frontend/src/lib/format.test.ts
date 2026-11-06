import { describe, expect, it } from 'vitest'
import { initials } from './format'

describe('initials', () => {
  it.each([
    ['Alice', 'A'],
    ['alice smith', 'AS'],
    ['  Mary Jane Watson  ', 'MW'],
    ['สมชาย', 'ส'],
    ['สมชาย ใจดี', 'สจ'],
    ['เอก', 'อ'], // a Thai vowel written first is skipped
    ['ไพลิน', 'พ'],
    ['', '?'],
  ])('%s -> %s', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})
