import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '../App'
import { fakeBackend, project } from '../test/fakeBackend'
import { renderApp } from '../test/render'

const titleIs = (title: string) => waitFor(() => expect(document.title).toBe(title))

describe('the browser tab title', () => {
  beforeEach(() => {
    document.title = 'Left over from before'
  })

  it('names the login page', async () => {
    fakeBackend()
    renderApp(<AppRoutes />, { route: '/login' })
    await titleIs('Log in · TaskFlow')
  })

  it('names the sign-up page', async () => {
    fakeBackend()
    renderApp(<AppRoutes />, { route: '/register' })
    await titleIs('Create your account · TaskFlow')
  })

  it('names the page that does not exist', async () => {
    fakeBackend()
    renderApp(<AppRoutes />, { route: '/no/such/page' })
    await titleIs('Page not found · TaskFlow')
  })

  it('no longer shows the project after logging out', async () => {
    fakeBackend({ projects: [project('p1', 'Secret plan')] })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/projects/p1' })
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await titleIs('Secret plan · TaskFlow')

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await titleIs('Log in · TaskFlow')
  })
})
