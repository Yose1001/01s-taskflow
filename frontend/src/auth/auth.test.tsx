import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../App'
import { renderApp } from '../test/render'
import { SESSION_HINT_KEY } from './AuthProvider'
import { LOGIN_OK, ME, TOKEN, allBrowserStorage, mockApi } from '../test/mockApi'

type Routes = Parameters<typeof mockApi>[0]

const unauthorized = {
  status: 401,
  body: { code: 'unauthorized', message: 'authentication required' },
}
const wrongPassword = {
  status: 401,
  body: { code: 'invalid_credentials', message: 'invalid email or password' },
}

/** A server where login works and /me answers only for a request that carries the token. */
function server(extra: Routes = {}) {
  return mockApi({
    'POST /auth/login': () => LOGIN_OK,
    'POST /auth/refresh': () => unauthorized, // no session cookie unless a test says otherwise
    'POST /auth/logout': () => ({ status: 204 }),
    'GET /projects': () => ({ body: { items: [], total: 0 } }), // the page shown right after signing in
    'GET /me': (req) =>
      req.headers.get('Authorization') === `Bearer ${TOKEN}` ? { body: ME } : unauthorized,
    ...extra,
  })
}

async function logIn(
  user: ReturnType<typeof userEvent.setup>,
  email = 'alice@example.com',
  password = 'correct horse',
) {
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
}

const html = () => document.documentElement

describe('protected pages', () => {
  it('send a signed-out visitor to the login page', () => {
    renderApp(<AppRoutes />, { route: '/' })
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
  })

  it('leave the design showcase and the 404 page open to everyone', () => {
    renderApp(<AppRoutes />, { route: '/design' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome to TaskFlow' }),
    ).toBeInTheDocument()
  })
})

describe('login', () => {
  it('signs in, calls /me with the token, and shows the dashboard', async () => {
    const api = server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })

    await logIn(user)

    expect(
      await screen.findByRole('heading', { name: 'Hello, alice@example.com' }),
    ).toBeInTheDocument()
    expect(api.to('POST /auth/login')[0]!.body).toEqual({
      email: 'alice@example.com',
      password: 'correct horse',
    })
    expect(api.to('POST /auth/login')[0]!.headers.get('Authorization')).toBeNull() // login itself carries no token
    expect(api.to('GET /me')[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(api.calls.every((c) => c.credentials === 'same-origin')).toBe(true)
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe('1') // a reload will try to restore the session
    expect(api.unhandled).toEqual([])
  })

  it('NEVER stores the token in localStorage, sessionStorage or cookies', async () => {
    server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })

    expect(allBrowserStorage()).not.toContain(TOKEN)
    expect(allBrowserStorage()).not.toContain('correct horse') // nor the password
  })

  it('trims the email', async () => {
    const api = server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user, '  alice@example.com  ')
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    expect((api.to('POST /auth/login')[0]!.body as { email: string }).email).toBe(
      'alice@example.com',
    )
  })

  it('submits with the Enter key', async () => {
    const api = server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse{Enter}')
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    expect(api.to('POST /auth/login')).toHaveLength(1)
  })

  it('checks the form before calling the server, and focuses the first problem', async () => {
    const api = server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })

    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getAllByText('This field is required.')).toHaveLength(2)
    expect(screen.getByLabelText('Email')).toHaveFocus()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(api.calls).toHaveLength(0)

    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Enter a valid email address.',
    )
    expect(api.calls).toHaveLength(0)
  })

  it('says so when the password is wrong, in the chosen language', async () => {
    server({ 'POST /auth/login': () => wrongPassword })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect.',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument() // still on the login page

    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    expect(screen.getByRole('alert')).toHaveTextContent('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
  })

  it('tells the person how long to wait when rate limited', async () => {
    server({
      'POST /auth/login': () => ({
        status: 429,
        body: { code: 'rate_limited', message: 'x' },
        headers: { 'Retry-After': '42' },
      }),
    })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('42 seconds')
  })

  it('explains a network failure', async () => {
    server()
    const { vi } = await import('vitest')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server')
  })

  it('disables the button and shows progress while waiting, so it cannot be double-submitted', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const api = server({ 'POST /auth/login': async () => (await gate, LOGIN_OK) })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)

    const button = await screen.findByRole('button', { name: 'Logging in...' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    release()
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    expect(api.to('POST /auth/login')).toHaveLength(1)
  })

  it('shows server-side field errors next to the fields', async () => {
    server({
      'POST /auth/login': () => ({
        status: 422,
        body: { code: 'validation_failed', message: 'x', fields: { email: 'invalid_email' } },
      }),
    })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // no banner: the problem is on the field
  })

  it('lets the person reveal and hide the password', async () => {
    server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    const box = screen.getByLabelText('Password')
    expect(box).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(box).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(box).toHaveAttribute('type', 'password')
  })

  it('uses the right autocomplete hints so password managers work', () => {
    renderApp(<AppRoutes />, { route: '/login' })
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('applies the language and theme saved on the account', async () => {
    server({
      'GET /me': () => ({ body: { ...ME, locale: 'th', theme: 'dark', displayName: 'อลิซ' } }),
    })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    expect(
      await screen.findByRole('heading', { name: 'สวัสดี alice@example.com' }),
    ).toBeInTheDocument()
    expect(html()).toHaveAttribute('lang', 'th')
    expect(html()).toHaveAttribute('data-theme', 'dark')
  })

  it('ignores a "next" address in the URL (no open redirect)', async () => {
    server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login?next=https://evil.example.com' })
    await logIn(user)
    expect(
      await screen.findByRole('heading', { name: 'Hello, alice@example.com' }),
    ).toBeInTheDocument()
  })

  it('keeps a signed-in user out of the login page', async () => {
    server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    await user.click(screen.getByRole('link', { name: 'TaskFlow' }))
    expect(screen.getByRole('heading', { name: 'Hello, alice@example.com' })).toBeInTheDocument()
  })
})

describe('logout and session end', () => {
  it('logs out: back to the login page, and the dashboard is closed again', async () => {
    server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
    // The top bar offers Log in / Sign up again instead of the name and Log out.
    const topBar = within(screen.getByRole('banner'))
    expect(topBar.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
    expect(topBar.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('after a log out, the next login starts at home, not on the page that was just left', async () => {
    server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/projects/trash' })
    await logIn(user)
    // Visiting a page while signed out and then logging in brings the person to that page...
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument()

    // ...but after choosing to log out, the next person (maybe someone else) starts fresh.
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await screen.findByRole('heading', { level: 1, name: 'Log in' })
    await logIn(user)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hello, alice@example.com' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Trash' })).not.toBeInTheDocument()
  })

  it('after the session EXPIRES, logging in again does bring the person back to where they were', async () => {
    server({ 'PATCH /me': () => unauthorized })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/projects/trash' })
    await logIn(user)
    await screen.findByRole('heading', { level: 1, name: 'Trash' })

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' })) // an authenticated call that gets a 401
    await screen.findByText('Your session ended. Please log in again.')
    await logIn(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument()
  })

  it('ends the session with an explanation when the server says the token is no longer valid (401)', async () => {
    server({ 'PATCH /me': () => unauthorized })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' })) // triggers an authenticated call
    expect(await screen.findByText('Your session ended. Please log in again.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
  })

  it('quietly gets a new token just before the old one expires', async () => {
    const api = server({
      'POST /auth/login': () => ({
        body: { accessToken: TOKEN, tokenType: 'Bearer', expiresIn: 11 },
      }), // 11s - 10s margin = renew after 1s
      'POST /auth/refresh': () => LOGIN_OK,
    })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    await waitFor(() => expect(api.to('POST /auth/refresh')).toHaveLength(1), { timeout: 4000 })
    expect(screen.getByRole('heading', { name: 'Hello, alice@example.com' })).toBeInTheDocument()
    expect(screen.queryByText('Your session ended. Please log in again.')).not.toBeInTheDocument()
  })

  it('ends the session when the server will not renew it', async () => {
    server({
      'POST /auth/login': () => ({
        body: { accessToken: TOKEN, tokenType: 'Bearer', expiresIn: 11 },
      }),
    }) // refresh answers 401
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    await waitFor(
      () =>
        expect(screen.getByText('Your session ended. Please log in again.')).toBeInTheDocument(),
      { timeout: 4000 },
    )
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull()
  })

  it('a refused access token is renewed once and the request is repeated', async () => {
    let projectCalls = 0
    const api = server({
      'POST /auth/refresh': () => LOGIN_OK,
      'GET /projects': () =>
        ++projectCalls === 1 ? unauthorized : { body: { items: [], total: 0 } },
    })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    expect(await screen.findByText('You have no projects yet.')).toBeInTheDocument()
    expect(api.to('POST /auth/refresh')).toHaveLength(1)
    expect(screen.queryByText('Your session ended. Please log in again.')).not.toBeInTheDocument()
  })

  it('logging out also ends the session on the server', async () => {
    const api = server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await waitFor(() => expect(api.to('POST /auth/logout')).toHaveLength(1))
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull()
  })
})

describe('the account menu', () => {
  it('shows who is signed in and offers Log out', async () => {
    server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    // People are shown by the email they log in with: the display name appears nowhere.
    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument()

    const button = screen.getByRole('button', { name: 'Account menu' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    await user.click(button)
    expect(screen.getByText('Signed in as')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    const logOut = screen.getByRole('menuitem', { name: 'Log out' })
    expect(logOut).toHaveFocus()
    expect(logOut.querySelector('svg')).toHaveAttribute('aria-hidden', 'true') // an icon, and text says it too

    await user.keyboard('{Escape}')
    expect(button).toHaveFocus()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
  })

  it('offers Log in and Sign up to visitors instead', () => {
    renderApp(<AppRoutes />, { route: '/login' })
    const topBar = within(screen.getByRole('banner'))
    expect(topBar.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
    expect(topBar.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
  })
})

describe('staying signed in after a reload', () => {
  it('brings the session back without asking for the password', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1')
    const api = server({ 'POST /auth/refresh': () => LOGIN_OK })
    renderApp(<AppRoutes />, { route: '/projects/trash' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument()
    expect(api.to('POST /auth/login')).toHaveLength(0)
    expect(api.to('GET /me')[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(allBrowserStorage()).not.toContain(TOKEN)
  })

  it('shows a loading state, not the login page, while it checks', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1')
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    server({ 'POST /auth/refresh': async () => (await gate, LOGIN_OK) })
    renderApp(<AppRoutes />, { route: '/' })

    expect(screen.getByText('Signing you back in...')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Log in' })).not.toBeInTheDocument()
    release()
    expect(
      await screen.findByRole('heading', { name: 'Hello, alice@example.com' }),
    ).toBeInTheDocument()
  })

  it('goes to the login page when the session is gone, and stops trying', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1')
    const api = server() // refresh answers 401
    renderApp(<AppRoutes />, { route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
    expect(api.to('POST /auth/refresh')).toHaveLength(1)
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull()
  })

  it('makes no request at all for a visitor who never signed in', () => {
    const api = server()
    renderApp(<AppRoutes />, { route: '/' })
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)
  })
})

describe('saving language and theme to the account', () => {
  it('saves a theme change while signed in', async () => {
    const api = server({ 'PATCH /me': (req) => ({ body: { ...ME, ...(req.body as object) } }) })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    await waitFor(() => expect(api.to('PATCH /me')).toHaveLength(1))
    expect(api.to('PATCH /me')[0]!.body).toEqual({ theme: 'dark' })
    expect(api.to('PATCH /me')[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('saves a language change while signed in', async () => {
    const api = server({ 'PATCH /me': (req) => ({ body: { ...ME, ...(req.body as object) } }) })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })

    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    await waitFor(() => expect(api.to('PATCH /me')).toHaveLength(1))
    expect(api.to('PATCH /me')[0]!.body).toEqual({ locale: 'th' })
  })

  it('makes NO API call when signed out', async () => {
    const api = server()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    expect(api.calls).toHaveLength(0)
    expect(html()).toHaveAttribute('data-theme', 'dark') // the local choice still works
  })

  it('keeps the local choice even if saving fails', async () => {
    server({ 'PATCH /me': () => ({ status: 500, body: { code: 'internal_error', message: 'x' } }) })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/login' })
    await logIn(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(html()).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('heading', { name: 'Hello, alice@example.com' })).toBeInTheDocument() // still signed in
  })
})

describe('sign up', () => {
  const fillSignup = async (
    user: ReturnType<typeof userEvent.setup>,
    password = 'correct horse',
  ) => {
    await user.type(screen.getByLabelText('Your name'), 'Alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), password)
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
  }
  const signupServer = (extra: Routes = {}) =>
    server({
      'POST /auth/register': () => ({ status: 201, body: ME }),
      'PATCH /me': (req) => ({ body: { ...ME, ...(req.body as object) } }),
      ...extra,
    })
  // The header also has a "Sign up" link; the form's submit is the only BUTTON with that name.

  it('creates the account, signs in, and starts the account with the chosen language and theme', async () => {
    const api = signupServer()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/register' })

    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    await user.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นธีมมืด' }))
    // The form is Thai now.
    await user.type(screen.getByLabelText('ชื่อของคุณ'), 'Alice')
    await user.type(screen.getByLabelText('อีเมล'), 'alice@example.com')
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'สมัครสมาชิก' }))

    await waitFor(() => expect(html()).toHaveAttribute('lang', 'th'))
    await screen.findByRole('heading', { name: /สวัสดี/ })
    expect(api.to('POST /auth/register')[0]!.body).toEqual({
      displayName: 'Alice',
      email: 'alice@example.com',
      password: 'correct horse',
    })
    expect(api.to('POST /auth/login')).toHaveLength(1)
    expect(api.to('PATCH /me')[0]!.body).toEqual({ locale: 'th', theme: 'dark' })
    expect(api.unhandled).toEqual([])
  })

  it('does not store the token or password', async () => {
    signupServer()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/register' })
    await fillSignup(user)
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    expect(allBrowserStorage()).not.toContain(TOKEN)
    expect(allBrowserStorage()).not.toContain('correct horse')
  })

  it('checks everything before calling the server', async () => {
    const api = signupServer()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/register' })

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByLabelText('Your name')).toHaveFocus()
    expect(screen.getAllByText(/required|at least 8/i).length).toBeGreaterThanOrEqual(3)

    await user.type(screen.getByLabelText('Your name'), 'Alice')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)
  })

  it('rejects a password over the 72-byte limit, counting Thai letters as 3 bytes', async () => {
    const api = signupServer()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/register' })
    await fillSignup(user, 'ก'.repeat(25)) // 25 letters but 75 bytes
    expect(await screen.findByText(/72 bytes at most/)).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)
  })

  it('accepts a Thai password of exactly 72 bytes (24 letters)', async () => {
    const api = signupServer()
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/register' })
    await fillSignup(user, 'ก'.repeat(24))
    await screen.findByRole('heading', { name: 'Hello, alice@example.com' })
    expect(api.to('POST /auth/register')).toHaveLength(1)
  })

  it('shows "email already registered" on the email field', async () => {
    signupServer({
      'POST /auth/register': () => ({ status: 409, body: { code: 'email_taken', message: 'x' } }),
    })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/register' })
    await fillSignup(user)
    const message = await screen.findByText('This email is already registered.')
    expect(message).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('still signs the person in if saving their preferences fails', async () => {
    signupServer({
      'PATCH /me': () => ({ status: 500, body: { code: 'internal_error', message: 'x' } }),
    })
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/register' })
    await fillSignup(user)
    expect(
      await screen.findByRole('heading', { name: 'Hello, alice@example.com' }),
    ).toBeInTheDocument()
  })

  it('uses new-password autocomplete', () => {
    renderApp(<AppRoutes />, { route: '/register' })
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
  })
})
