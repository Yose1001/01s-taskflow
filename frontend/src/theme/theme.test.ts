import { describe, expect, it, vi } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  systemPrefersDark,
} from './theme'
import { setSystemDark } from '../test/matchMedia'

describe('resolveTheme', () => {
  it('uses the explicit choice regardless of the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system when the choice is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('stored theme', () => {
  it('defaults to "system" when nothing is saved', () => {
    expect(readStoredTheme()).toBe('system')
  })

  it('returns a saved valid choice', () => {
    for (const choice of ['light', 'dark', 'system'] as const) {
      storeTheme(choice)
      expect(readStoredTheme()).toBe(choice)
    }
  })

  it('ignores invalid saved values instead of trusting them', () => {
    for (const bad of ['purple', '', 'DARK', '<script>', 'null']) {
      localStorage.setItem(THEME_STORAGE_KEY, bad)
      expect(readStoredTheme()).toBe('system')
    }
  })

  it('still works when storage is blocked (e.g. private mode)', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readStoredTheme()).toBe('system')
    expect(() => storeTheme('dark')).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })
})

describe('applying the theme', () => {
  it('sets data-theme on <html>', () => {
    applyResolvedTheme('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    applyResolvedTheme('light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('reads the operating system setting', () => {
    expect(systemPrefersDark()).toBe(false)
    setSystemDark(true)
    expect(systemPrefersDark()).toBe(true)
  })
})
