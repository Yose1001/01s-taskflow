import { describe, expect, it, vi } from 'vitest'
import { setSystemDark } from '../test/matchMedia'
import {
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  devicePrefersDark,
  initialTheme,
  isTheme,
  readStoredTheme,
  storeTheme,
} from './theme'

describe('themes', () => {
  it('are exactly light and dark', () => {
    expect([...THEMES]).toEqual(['light', 'dark'])
    expect(isTheme('light')).toBe(true)
    expect(isTheme('dark')).toBe(true)
    for (const other of ['system', 'auto', '', 'purple', null, undefined, 1]) {
      expect(isTheme(other), String(other)).toBe(false)
    }
  })
})

describe('stored theme', () => {
  it('is null when nothing is saved', () => {
    expect(readStoredTheme()).toBeNull()
  })

  it('returns a saved valid choice', () => {
    for (const choice of ['light', 'dark'] as const) {
      storeTheme(choice)
      expect(readStoredTheme()).toBe(choice)
    }
  })

  it('ignores invalid saved values instead of trusting them (including the old "system")', () => {
    for (const bad of ['system', 'purple', '', 'DARK', '<script>', 'null']) {
      localStorage.setItem(THEME_STORAGE_KEY, bad)
      expect(readStoredTheme(), bad).toBeNull()
    }
  })

  it('still works when storage is blocked (e.g. private mode)', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readStoredTheme()).toBeNull()
    expect(() => storeTheme('dark')).not.toThrow()
    expect(['light', 'dark']).toContain(initialTheme())
    get.mockRestore()
    set.mockRestore()
  })
})

describe('initial theme', () => {
  it('starts from the device preference on the very first visit', () => {
    expect(initialTheme()).toBe('light')
    setSystemDark(true)
    expect(devicePrefersDark()).toBe(true)
    expect(initialTheme()).toBe('dark')
  })

  it('lets a saved choice win over the device preference', () => {
    setSystemDark(true)
    storeTheme('light')
    expect(initialTheme()).toBe('light')

    setSystemDark(false)
    storeTheme('dark')
    expect(initialTheme()).toBe('dark')
  })

  it('treats an old saved "system" like nothing saved', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system')
    setSystemDark(true)
    expect(initialTheme()).toBe('dark')
  })
})

describe('applying the theme', () => {
  it('sets data-theme on <html>', () => {
    applyTheme('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    applyTheme('light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })
})
