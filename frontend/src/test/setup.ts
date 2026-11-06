import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import i18n from '../i18n'
import { resetMatchMedia } from './matchMedia'

beforeEach(async () => {
  localStorage.clear()
  resetMatchMedia()
  document.documentElement.setAttribute('data-theme', 'light')
  await i18n.changeLanguage('en')
  localStorage.clear() // changeLanguage saves the choice; start every test with nothing saved
})

afterEach(() => {
  cleanup()
})
