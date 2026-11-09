import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './App'
import { renderApp } from './test/render'

describe('app (signed out)', () => {
  it('shows the top bar with the switches and the log in / sign up links', () => {
    renderApp(<AppRoutes />, { route: '/design' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome to TaskFlow' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch language to ไทย' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /TaskFlow/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register')
  })

  it('translates the whole page when the language changes', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/design' })
    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    expect(
      screen.getByRole('heading', { level: 1, name: 'ยินดีต้อนรับสู่ TaskFlow' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Welcome to TaskFlow')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'เข้าสู่ระบบ' })).toBeInTheDocument()
  })

  it('changes the theme from the top bar', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/design' })
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('shows a friendly page for unknown addresses', () => {
    renderApp(<AppRoutes />, { route: '/nothing-here' })
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  })

  it('links between the login and sign-up pages', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    // There is a "Sign up" link in the top bar and one under the form: use the one in the page body.
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Sign up' }))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument()
  })
})
