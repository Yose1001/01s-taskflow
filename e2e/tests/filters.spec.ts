import { expect, test } from '@playwright/test'
import {
  createProjectViaApi,
  createTaskViaApi,
  inviteViaApi,
  loginViaUi,
  newUser,
  openProject,
  reloadSignedIn,
  titlesIn,
  toggleAssignees,
} from './helpers'

test.use({ viewport: { width: 1400, height: 900 } })

test.describe('search and filters', () => {
  test('narrow the board, show the count, keep the choice in the address, and survive a reload', async ({
    page,
    request,
  }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    const projectId = await createProjectViaApi(request, alice.token, 'Studio')
    const bobId = await inviteViaApi(request, alice.token, projectId, bob.person.email)
    await createTaskViaApi(request, alice.token, projectId, { title: 'Fix Login bug', priority: 'high', assigneeIds: [bobId] })
    await createTaskViaApi(request, alice.token, projectId, { title: 'Write docs', priority: 'low' })
    await createTaskViaApi(request, alice.token, projectId, { title: 'Plan login page', priority: 'high', status: 'review' })
    await createTaskViaApi(request, alice.token, projectId, { title: '100% done', status: 'done' })

    await loginViaUi(page, alice.person)
    await openProject(page, 'Studio')
    await expect(page.getByRole('region', { name: /^To do, 2/ })).toBeVisible()

    // Search ignores capital letters
    await page.getByLabel('Search tasks').fill('LOGIN')
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Fix Login bug'])
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Plan login page'])
    await expect(page.getByText('Showing 2 of 4 tasks')).toBeVisible()
    await expect(page).toHaveURL(/q=LOGIN/)

    // % is an ordinary letter, not a wildcard
    await page.getByLabel('Search tasks').fill('%')
    await expect.poll(() => titlesIn(page, /^Done/)).toEqual(['100% done'])
    await page.getByLabel('Search tasks').fill('login')

    // Priority and person narrow it further
    await page.getByLabel('Priority').selectOption('High')
    await toggleAssignees(page, [bob.person.name])
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Fix Login bug'])
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual([])
    await expect(page.getByText('Showing 1 of 4 tasks')).toBeVisible()

    // After a reload the person is still signed in, and the filters are still there
    await reloadSignedIn(page)
    await expect(page.getByLabel('Search tasks')).toHaveValue('login')
    await expect(page.getByLabel('Priority')).toHaveValue('high')
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Fix Login bug'])

    // Unassigned, then clear everything
    await page.getByLabel('Search tasks').fill('')
    await page.getByLabel('Priority').selectOption('All')
    await toggleAssignees(page, [bob.person.name, 'Unassigned'])
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Write docs'])
    // Several people at once: any of them is enough.
    await toggleAssignees(page, [bob.person.name])
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Fix Login bug', 'Write docs'])
    await expect(page.getByRole('button', { name: 'Assigned to: Unassigned +1' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear all' }).click()
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Fix Login bug', 'Write docs'])
    await expect(page).not.toHaveURL(/priority=|assignee=|q=/)
  })

  test('says so when nothing matches, and ignores nonsense in the address', async ({ page, request }) => {
    const { person, token } = await newUser(request, 'Carol')
    const projectId = await createProjectViaApi(request, token, 'Tiny')
    await createTaskViaApi(request, token, projectId, { title: 'Only task' })

    await page.goto(`/projects/${projectId}?priority=urgent&assignee=someone-else`)
    await page.getByLabel('Email').fill(person.email)
    await page.getByLabel('Password', { exact: true }).fill(person.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('button', { name: 'Only task', exact: true })).toBeVisible() // nonsense was ignored
    await expect(page.getByLabel('Priority')).toHaveValue('')

    await page.getByLabel('Search tasks').fill('zzzz')
    await expect(page.getByText('No tasks match the filters.')).toBeVisible()
  })
})
