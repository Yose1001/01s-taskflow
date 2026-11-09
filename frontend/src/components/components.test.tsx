import { cleanup, screen, waitFor } from '@testing-library/react'
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
  const toDark = { name: 'Switch to dark theme' }
  const toLight = { name: 'Switch to light theme' }

  it('is one button that switches between the only two themes', async () => {
    const user = userEvent.setup()
    renderApp(<ThemeSwitcher />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await user.click(screen.getByRole('button', toDark))
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', toLight)).toBeInTheDocument()
  })

  it('on the very first visit starts from the device preference', () => {
    renderApp(<ThemeSwitcher />)
    expect(html()).toHaveAttribute('data-theme', 'light')
    expect(screen.getByRole('button', toDark)).toBeInTheDocument()
    cleanup()

    setSystemDark(true)
    renderApp(<ThemeSwitcher />)
    expect(html()).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('button', toLight)).toBeInTheDocument()
  })

  it('lets the user force dark and light, and remembers the choice', async () => {
    const user = userEvent.setup()
    renderApp(<ThemeSwitcher />)

    await user.click(screen.getByRole('button', toDark))
    expect(html()).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('tf-theme')).toBe('dark')

    await user.click(screen.getByRole('button', toLight))
    expect(html()).toHaveAttribute('data-theme', 'light')
    expect(localStorage.getItem('tf-theme')).toBe('light')
  })

  it('ignores the device once a theme is chosen, even if the device changes later', async () => {
    const user = userEvent.setup()
    renderApp(<ThemeSwitcher />)
    await user.click(screen.getByRole('button', toDark))
    await user.click(screen.getByRole('button', toLight))
    setSystemDark(true)
    // Give any (unwanted) listener a chance to react, then check nothing changed.
    await waitFor(() => expect(html()).toHaveAttribute('data-theme', 'light'))
    expect(screen.getByRole('button', toDark)).toBeInTheDocument()
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
    expect(screen.getByRole('button', toLight)).toBeInTheDocument()
  })
})

describe('LanguageSwitcher', () => {
  it('switches the whole UI between English and Thai, and remembers it', async () => {
    const user = userEvent.setup()
    renderApp(<LanguageSwitcher />)

    const button = screen.getByRole('button', { name: 'Switch language to ไทย' })
    expect(button).toHaveTextContent('EN') // shows the current language

    await user.click(button)
    expect(screen.getByRole('button', { name: 'เปลี่ยนภาษาเป็น English' })).toHaveTextContent('TH')
    expect(html()).toHaveAttribute('lang', 'th')
    expect(localStorage.getItem('tf-lang')).toBe('th')

    await user.click(screen.getByRole('button', { name: 'เปลี่ยนภาษาเป็น English' }))
    expect(html()).toHaveAttribute('lang', 'en')
  })
})

describe('badges', () => {
  it('show the status as text and an icon, never color alone', () => {
    renderApp(
      <>
        <StatusBadge status="todo" />
        <StatusBadge status="in_progress" />
        <StatusBadge status="review" />
        <StatusBadge status="on_hold" />
        <StatusBadge status="done" />
      </>,
    )
    for (const label of ['To do', 'In progress', 'In review', 'On hold', 'Done']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // The icons are decoration: hidden from screen readers, the text carries the meaning.
    const icons = document.querySelectorAll('svg[aria-hidden="true"]')
    expect(icons.length).toBe(5)
    const shapes = new Set([...icons].map((i) => i.innerHTML))
    expect(shapes.size).toBe(5) // five different shapes, so they differ without color too
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
