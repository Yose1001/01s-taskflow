import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './App'
import { renderApp } from './test/render'

describe('app', () => {
  it('shows the home page with the switches in the top bar', () => {
    renderApp(<AppRoutes />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome to TaskFlow' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /TaskFlow/ })).toHaveAttribute('href', '/')
  })

  it('translates the whole page when the language changes', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />)
    await user.click(screen.getByRole('button', { name: 'ไทย' }))
    expect(
      screen.getByRole('heading', { level: 1, name: 'ยินดีต้อนรับสู่ TaskFlow' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Welcome to TaskFlow')).not.toBeInTheDocument()
  })

  it('changes the theme from the top bar', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />)
    await user.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('shows a friendly page for unknown addresses', () => {
    renderApp(<AppRoutes />, { route: '/nothing-here' })
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  })
})
