import { expect, type APIRequestContext, type Page } from '@playwright/test'

// Shared helpers. Setting things up through the API (fast) keeps each test about the one thing it checks;
// the thing under test is always done through the screen.

export const API = 'http://localhost:8081/api/v1'
/** A throwaway password for throwaway test users in the throwaway test database. */
export const PASSWORD = 'correct horse battery'

export interface Person {
  name: string
  email: string
  password: string
}

let counter = 0

/** A new person nobody has used before (a unique email), so tests never collide. */
export function newPerson(label: string): Person {
  const unique = `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`
  return { name: label, email: `${label.toLowerCase()}-${unique}@e2e.test`, password: PASSWORD }
}

export async function registerViaApi(request: APIRequestContext, person: Person): Promise<void> {
  const res = await request.post(`${API}/auth/register`, {
    data: { email: person.email, password: person.password, displayName: person.name },
  })
  expect(res.status(), 'register via API').toBe(201)
}

export async function tokenFor(request: APIRequestContext, person: Person): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: person.email, password: person.password },
  })
  expect(res.status(), 'login via API').toBe(200)
  return ((await res.json()) as { accessToken: string }).accessToken
}

/** Registers a person and returns their API token. */
export async function newUser(request: APIRequestContext, label: string) {
  const person = newPerson(label)
  await registerViaApi(request, person)
  return { person, token: await tokenFor(request, person) }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function createProjectViaApi(
  request: APIRequestContext,
  token: string,
  name: string,
  description = '',
): Promise<string> {
  const res = await request.post(`${API}/projects`, {
    headers: auth(token),
    data: { name, description },
  })
  expect(res.status(), 'create project via API').toBe(201)
  return ((await res.json()) as { id: string }).id
}

export async function inviteViaApi(
  request: APIRequestContext,
  token: string,
  projectId: string,
  email: string,
): Promise<string> {
  const res = await request.post(`${API}/projects/${projectId}/members`, {
    headers: auth(token),
    data: { email },
  })
  expect(res.status(), 'invite via API').toBe(201)
  return ((await res.json()) as { userId: string }).userId
}

export interface TaskSeed {
  title: string
  status?: 'todo' | 'in_progress' | 'review' | 'on_hold' | 'done'
  priority?: 'low' | 'medium' | 'high'
  holdReason?: string
  assigneeIds?: string[]
  subtasks?: string[]
  startDate?: string
  dueDate?: string
}

export async function createTaskViaApi(
  request: APIRequestContext,
  token: string,
  projectId: string,
  task: TaskSeed,
): Promise<string> {
  const res = await request.post(`${API}/projects/${projectId}/tasks`, {
    headers: auth(token),
    data: task,
  })
  expect(res.status(), 'create task via API').toBe(201)
  return ((await res.json()) as { id: string }).id
}

/** What the server has for a project's tasks, as "status: title, title" per column (to compare with the screen). */
export async function boardOnServer(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<Record<string, string[]>> {
  const res = await request.get(`${API}/projects/${projectId}/tasks?pageSize=100`, {
    headers: auth(token),
  })
  expect(res.status()).toBe(200)
  const { items } = (await res.json()) as { items: Array<{ title: string; status: string }> }
  const columns: Record<string, string[]> = { todo: [], in_progress: [], review: [], on_hold: [], done: [] }
  for (const t of items) columns[t.status]!.push(t.title) // the API returns them in board order
  return columns
}

/** Fills in and sends the login form that is already on screen. */
export async function submitLogin(page: Page, person: Person): Promise<void> {
  await page.getByLabel('Email').fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(person.password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

/** Opens the login page, signs in, and waits until the project list is showing. */
export async function loginViaUi(page: Page, person: Person): Promise<void> {
  await page.goto('/login')
  await submitLogin(page, person)
  await expect(page.getByText(`Signed in as ${person.email}`, { exact: true })).toBeVisible()
}

/**
 * Reloads the page. The person stays signed in (the refresh cookie brings the session back)
 * and stays on the same page.
 */
export async function reloadSignedIn(page: Page): Promise<void> {
  const before = page.url()
  await page.reload()
  await expect(page).toHaveURL(before)
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
}

/** Opens a project by clicking its card in the list. */
export async function openProject(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** The titles of the cards in a column, top to bottom. */
export async function titlesIn(page: Page, column: RegExp | string): Promise<string[]> {
  const region = page.getByRole('region', { name: column })
  // The card title is the only button in a card without an aria-label (the drag handle has one).
  return region.locator('li button:not([aria-label])').allTextContents()
}

/** Chooses a day in the calendar of the date field with this label. */
/** Ticks or unticks people in the board's "Assigned to" menu ('All' takes every tick off), then closes it. */
export async function toggleAssignees(page: Page, names: string[]): Promise<void> {
  await page.getByRole('button', { name: /^Assigned to:/ }).click()
  for (const name of names) await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
  await page.keyboard.press('Escape')
}

export async function pickDay(page: Page, label: string, day: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click()
  const calendar = page.getByRole('dialog', { name: label })
  await calendar.getByLabel('Year', { exact: true }).selectOption(day.slice(0, 4))
  await calendar.getByLabel('Month', { exact: true }).selectOption(String(Number(day.slice(5, 7)) - 1))
  await calendar.locator(`[data-day="${day}"]`).click()
}
