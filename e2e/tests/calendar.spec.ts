import { expect, test } from '@playwright/test'
import { createProjectViaApi, createTaskViaApi, inviteViaApi, loginViaUi, newUser } from './helpers'

test.describe('the calendar', () => {
  test('an important day shared with a person is seen by them, and changed only by its owner', async ({
    page,
    request,
    context,
  }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    const projectId = await createProjectViaApi(request, alice.token, 'Launch')
    await inviteViaApi(request, alice.token, projectId, bob.person.email)
    await createTaskViaApi(request, alice.token, projectId, { title: 'Ship it', dueDate: '2099-03-15' })

    // Alice adds a day to the project, from the calendar in the top bar.
    await loginViaUi(page, alice.person)
    await page.getByRole('link', { name: 'Calendar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible()
    await page.goto('/calendar?day=2099-03-15')
    await expect(page.getByRole('grid', { name: 'March 2099' })).toBeVisible()
    const day = page.getByRole('region', { name: 'Sunday, 15 March 2099' })
    await expect(day.getByRole('link', { name: /Ship it/ })).toBeVisible() // the task's end day

    await page.getByRole('button', { name: 'Add an important day' }).click()
    const form = page.getByRole('dialog', { name: 'Add an important day' })
    await form.getByLabel('Name').fill('Client demo')
    await form.getByLabel('Belongs to').selectOption({ label: 'Chosen people' })
    await form.getByRole('group', { name: 'Share with' }).getByRole('checkbox', { name: /Bob/ }).check()
    await form.getByRole('checkbox', { name: '3 days before' }).check()
    await form.getByRole('button', { name: 'Add' }).click()
    await expect(form).toHaveCount(0)
    await expect(day.getByText('Client demo')).toBeVisible()
    await expect(day.getByText('On the day, 1 day before, 3 days before')).toBeVisible()

    // Bob sees it, but it is Alice's to change.
    const other = await context.browser()!.newContext()
    const bobPage = await other.newPage()
    await loginViaUi(bobPage, bob.person)
    await bobPage.goto('/calendar?day=2099-03-15')
    const bobDay = bobPage.getByRole('region', { name: 'Sunday, 15 March 2099' })
    await expect(bobDay.getByText('Client demo')).toBeVisible()
    await expect(bobDay.getByText('Shared by Alice')).toBeVisible()
    await expect(bobDay.getByRole('button', { name: 'Edit Client demo' })).toHaveCount(0)
    await other.close()

    // Alice renames it, then deletes it.
    await day.getByRole('button', { name: 'Edit Client demo' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit important day' })
    await edit.getByLabel('Name').fill('Client demo day')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(day.getByText('Client demo day')).toBeVisible()
    await day.getByRole('button', { name: 'Edit Client demo day' }).click()
    await page.getByRole('dialog', { name: 'Edit important day' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete "Client demo day"?' }).getByRole('button', { name: 'Delete for good' }).click()
    await expect(day.getByText('Client demo day')).toHaveCount(0)
  })

  test("the calendar can show one person's tasks", async ({ page, request }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    const projectId = await createProjectViaApi(request, alice.token, 'Launch')
    const bobId = await inviteViaApi(request, alice.token, projectId, bob.person.email)
    await createTaskViaApi(request, alice.token, projectId, { title: "Bob's task", dueDate: '2099-03-15', assigneeIds: [bobId] })
    await createTaskViaApi(request, alice.token, projectId, { title: 'Nobody yet', dueDate: '2099-03-15' })

    await loginViaUi(page, alice.person)
    await page.goto('/calendar?day=2099-03-15')
    const day = page.getByRole('region', { name: 'Sunday, 15 March 2099' })
    await expect(day.getByRole('link', { name: /Nobody yet/ })).toBeVisible()
    await page.getByLabel('Tasks of').selectOption({ label: `Bob · ${bob.person.email}` })
    await expect(day.getByRole('link', { name: /Bob's task/ })).toBeVisible()
    await expect(day.getByRole('link', { name: /Nobody yet/ })).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`person=${bobId}`))
  })

  test('the keyboard moves through the month', async ({ page, request }) => {
    const { person } = await newUser(request, 'Carol')
    await loginViaUi(page, person)
    await page.goto('/calendar?day=2099-03-31')
    await page.getByRole('button', { name: /^Tuesday, 31 March 2099/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('grid', { name: 'April 2099' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Wednesday, 1 April 2099/ })).toBeFocused()
    await expect(page).toHaveURL(/day=2099-04-01/)
  })
})
