import { expect, test } from '@playwright/test'
import { loginViaUi, newPerson, newUser, registerViaApi, submitLogin } from './helpers'

test.describe('signing up and in', () => {
  test('a new person signs up, is signed in at once, can log out and log in again', async ({ page }) => {
    const person = newPerson('Alice')
    await page.goto('/register')
    await page.getByLabel('Your name').fill(person.name)
    await page.getByLabel('Email').fill(person.email)
    await page.getByLabel('Password', { exact: true }).fill(person.password)
    await page.getByRole('button', { name: 'Sign up' }).click()

    await expect(page.getByText(`Signed in as ${person.email}`, { exact: true })).toBeVisible()
    await expect(page.getByText('You have no projects yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login/)

    await submitLogin(page, person)
    await expect(page.getByText(`Signed in as ${person.email}`, { exact: true })).toBeVisible()
  })

  test('a wrong password is refused with a clear message, and nothing is opened', async ({ page, request }) => {
    const person = newPerson('Bob')
    await registerViaApi(request, person)

    await page.goto('/login')
    await submitLogin(page, { ...person, password: 'not the right one' })
    await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.')
    await expect(page).toHaveURL(/\/login/)
  })

  test('signing up twice with the same email shows an error next to the email', async ({ page, request }) => {
    const person = newPerson('Carol')
    await registerViaApi(request, person)

    await page.goto('/register')
    await page.getByLabel('Your name').fill('Someone else')
    await page.getByLabel('Email').fill(person.email)
    await page.getByLabel('Password', { exact: true }).fill(person.password)
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByText('This email is already registered.')).toBeVisible()
    await expect(page).toHaveURL(/\/register/)
  })

  test('a password that is too short is caught before anything is sent', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (r) => requests.push(r.url()))
    await page.goto('/register')
    await page.getByLabel('Your name').fill('Dave')
    await page.getByLabel('Email').fill(newPerson('Dave').email)
    await page.getByLabel('Password', { exact: true }).fill('short')
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible()
    expect(requests.filter((u) => u.includes('/auth/register'))).toHaveLength(0)
  })

  test('a page for signed-in people sends visitors to the login page, then brings them back', async ({
    page,
    request,
  }) => {
    const { person } = await newUser(request, 'Erin')
    await page.goto('/projects/trash')
    await expect(page).toHaveURL(/\/login/)
    await submitLogin(page, person)
    await expect(page).toHaveURL(/\/projects\/trash$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible()
  })

  test('the login page cannot be used to jump to another website', async ({ page, request }) => {
    const { person } = await newUser(request, 'Frank')
    // A crafted link tries to send the person elsewhere after login. It must be ignored.
    await page.goto('/login?redirect=https://evil.example/&from=https://evil.example/')
    await submitLogin(page, person)
    await expect(page.getByText(`Signed in as ${person.email}`, { exact: true })).toBeVisible()
    expect(new URL(page.url()).origin).toBe('http://localhost:5174')
  })

  test('the access token is never written to browser storage, and the only cookie is out of reach of page scripts', async ({
    page,
    request,
    context,
  }) => {
    const { person } = await newUser(request, 'Gina')
    await loginViaUi(page, person)

    const stored = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }),
    )
    expect(stored).not.toMatch(/eyJ[\w-]+\.[\w-]+\./) // the shape of a JWT
    expect(stored).not.toContain('taskflow_refresh') // page scripts cannot see the cookie at all

    const cookies = await context.cookies()
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatchObject({
      name: 'taskflow_refresh',
      path: '/api/v1/auth', // never sent with any other request
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    })
    expect(cookies[0]!.value).not.toMatch(/^eyJ/) // a random value, not the access token
  })

  test('the session survives a reload and a new tab; logging out ends it', async ({ page, request, context }) => {
    const { person } = await newUser(request, 'Hana')
    await loginViaUi(page, person)
    await page.getByRole('link', { name: 'Trash' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL(/\/projects\/trash$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible()

    const tab = await context.newPage()
    await tab.goto('/')
    await expect(tab.getByText(`Signed in as ${person.email}`, { exact: true })).toBeVisible()

    // Logging out in one tab ends the session in the other tab too.
    await tab.getByRole('button', { name: 'Account menu' }).click()
    await tab.getByRole('menuitem', { name: 'Log out' }).click()
    await expect(tab).toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)

    await page.reload()
    await expect(page).toHaveURL(/\/login/)
    expect(await context.cookies()).toHaveLength(0)
  })
})
