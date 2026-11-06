import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { setSystemDark } from '../test/matchMedia'
import { renderApp } from '../test/render'
import { LanguageSwitcher } from './LanguageSwitcher'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { ThemeSwitcher } from './ThemeSwitcher'

const html = () => document.documentElement

describe('ThemeSwitcher', () => {
  it('offers exactly two choices: Light and Dark (no "System")', () => {
    renderApp(<ThemeSwitcher />)
    const buttons = within(screen.getByRole('group', { name: 'Theme' })).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Light', 'Dark'])
    expect(screen.queryByRole('button', { name: 'System' })).not.toBeInTheDocument()
  })

  it('on the very first visit starts from the device preference', () => {
    renderApp(<ThemeSwitcher />)
    expect(html()).toHaveAttribute('data-theme', 'light')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
    cleanup()

    setSystemDark(true)
    renderApp(<ThemeSwitcher />)
    expect(html()).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('lets the user force dark and light, and remembers the choice', async () => {
    const user = userEvent.setup()
    renderApp(<ThemeSwitcher />)

    await user.click(screen.getByRole('button', { name: 'Dark' }))
    expect(html()).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('tf-theme')).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(html()).toHaveAttribute('data-theme', 'light')
    expect(localStorage.getItem('tf-theme')).toBe('light')
  })

  it('ignores the device once a theme is chosen, even if the device changes later', async () => {
    const user = userEvent.setup()
    renderApp(<ThemeSwitcher />)
    await user.click(screen.getByRole('button', { name: 'Light' }))
    setSystemDark(true)
    // Give any (unwanted) listener a chance to react, then check nothing changed.
    await waitFor(() => expect(html()).toHaveAttribute('data-theme', 'light'))
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a saved choice wins over the device on the next visit', () => {
    setSystemDark(true)
    localStorage.setItem('tf-theme', 'light')
    renderApp(<ThemeSwitcher />)
    expect(html()).toHaveAttribute('data-theme', 'light')
  })

  it('an old saved "system" value falls back to the device preference', () => {
    setSystemDark(true)
    localStorage.setItem('tf-theme', 'system')
    renderApp(<ThemeSwitcher />)
    expect(html()).toHaveAttribute('data-theme', 'dark')
  })

  it('restores a saved choice on the next visit', () => {
    localStorage.setItem('tf-theme', 'dark')
    renderApp(<ThemeSwitcher />)
    expect(html()).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('is a labelled group for screen readers', () => {
    renderApp(<ThemeSwitcher />)
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
  })
})

describe('LanguageSwitcher', () => {
  it('switches the whole UI between English and Thai, and remembers it', async () => {
    const user = userEvent.setup()
    renderApp(<LanguageSwitcher />)

    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'ไทย' }))
    expect(screen.getByRole('group', { name: 'ภาษา' })).toBeInTheDocument() // the label itself is now Thai
    expect(screen.getByRole('button', { name: 'ไทย' })).toHaveAttribute('aria-pressed', 'true')
    expect(html()).toHaveAttribute('lang', 'th')
    expect(localStorage.getItem('tf-lang')).toBe('th')

    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(html()).toHaveAttribute('lang', 'en')
  })

  it('names each language in its own language', () => {
    renderApp(<LanguageSwitcher />)
    expect(screen.getByRole('button', { name: 'ไทย' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()
  })
})

describe('badges', () => {
  it('show the status as text and an icon, never color alone', () => {
    renderApp(
      <>
        <StatusBadge status="todo" />
        <StatusBadge status="in_progress" />
        <StatusBadge status="review" />
        <StatusBadge status="done" />
      </>,
    )
    for (const label of ['To do', 'In progress', 'In review', 'Done']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // The icon characters are decoration: hidden from screen readers, the text carries the meaning.
    const icons = document.querySelectorAll('[aria-hidden="true"]')
    expect(icons.length).toBe(4)
    const shapes = new Set([...icons].map((i) => i.textContent))
    expect(shapes.size).toBe(4) // four different shapes, so they differ without color too
  })

  it('translate with the language', async () => {
    renderApp(
      <>
        <StatusBadge status="done" />
        <PriorityBadge priority="high" />
      </>,
    )
    expect(screen.getByText('Done')).toBeInTheDocument()
    await i18n.changeLanguage('th')
    expect(await screen.findByText('เสร็จแล้ว')).toBeInTheDocument()
    expect(screen.getByText('สูง')).toBeInTheDocument()
  })
})
