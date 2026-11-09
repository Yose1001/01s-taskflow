import { describe, expect, it } from 'vitest'
import { AVATAR_TONES, avatarTone } from './avatar'
import { formatDayShort, initials } from './format'

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

describe('formatDayShort', () => {
  const now = new Date('2026-06-15T12:00:00')

  it('leaves out the year when it is this year', () => {
    expect(formatDayShort('2026-11-20', 'en', now)).toBe('20 Nov')
    expect(formatDayShort('2026-11-20', 'th', now)).toBe('20 พ.ย.')
  })

  it('shows the year otherwise, and Thai years are Buddhist-era', () => {
    expect(formatDayShort('2027-01-02', 'en', now)).toBe('2 Jan 2027')
    expect(formatDayShort('2099-12-01', 'th', now)).toBe('1 ธ.ค. 2642')
  })

  it('gives nothing for a value that is not a day', () => {
    expect(formatDayShort('soon', 'en', now)).toBe('')
  })
})

describe('avatarTone', () => {
  it('gives the same person the same color, always from the six pairs', () => {
    expect(avatarTone('user-1')).toBe(avatarTone('user-1'))
    for (const id of ['a', 'b', 'c', '11111111-1111-1111-1111-111111111111', '']) {
      expect(AVATAR_TONES).toContain(avatarTone(id))
    }
  })

  it('spreads people across the colors', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `00000000-0000-0000-0000-${i}`)
    expect(new Set(ids.map(avatarTone)).size).toBe(AVATAR_TONES.length)
  })
})
