import { expect, test } from '@playwright/test'
import { createProjectViaApi, createTaskViaApi, inviteViaApi, loginViaUi, newUser } from './helpers'

test('the project list can be sorted, and this device remembers the choice', async ({ page, request }) => {
  const { person, token } = await newUser(request, 'Alice')
  const first = await createProjectViaApi(request, token, 'First')
  await createTaskViaApi(request, token, first, { title: 'a', status: 'done' })
  const second = await createProjectViaApi(request, token, 'Second')
  await createTaskViaApi(request, token, second, { title: 'a' })
  await createProjectViaApi(request, token, 'Third')

  await loginViaUi(page, person)
  const names = () => page.locator('ul[data-view] h3').allTextContents()
  await expect.poll(names).toEqual(['Third', 'Second', 'First'])

  const choose = async (name: string) => {
    await page.getByRole('button', { name: /^Sort projects/ }).click()
    await page.getByRole('menuitemradio', { name }).click()
  }
  await choose('Oldest first')
  await expect.poll(names).toEqual(['First', 'Second', 'Third'])
  await choose('Most progress first')
  await expect.poll(names).toEqual(['First', 'Second', 'Third'])
  await choose('Least progress first')
  await expect.poll(names).toEqual(['Second', 'First', 'Third'])

  await page.reload()
  await expect.poll(names).toEqual(['Second', 'First', 'Third'])
  await expect(page.getByRole('button', { name: 'Sort projects: Least progress first' })).toBeVisible()

  await choose('Newest first')
  await expect.poll(names).toEqual(['Third', 'Second', 'First'])
})

test("the project list shows each project's people and can keep one person's projects", async ({ page, request }) => {
  const alice = await newUser(request, 'Alice')
  const bob = await newUser(request, 'Bob')
  const shared = await createProjectViaApi(request, alice.token, 'Shared')
  const bobId = await inviteViaApi(request, alice.token, shared, bob.person.email)
  await createTaskViaApi(request, alice.token, shared, { title: 'a', assigneeIds: [bobId] })
  await createProjectViaApi(request, alice.token, 'Alone')

  await loginViaUi(page, alice.person)
  const names = () => page.locator('ul[data-view] h3').allTextContents()
  await expect.poll(names).toEqual(['Alone', 'Shared'])
  await expect(page.getByTitle('Members: Alice, Bob')).toBeVisible()

  await page.getByRole('button', { name: 'Show: All projects' }).click()
  await page.getByRole('menuitemcheckbox', { name: `Show projects: Where Bob has tasks · ${bob.person.email}` }).click()
  await expect.poll(names).toEqual(['Shared'])
  await page.keyboard.press('Escape') // several people can be ticked, so the menu stays open until then
  await expect(page).toHaveURL(new RegExp(`person=${bobId}`))

  await page.getByRole('button', { name: /^Sort projects/ }).click()
  await page.getByRole('menuitemradio', { name: 'Name A–Z' }).click()
  await expect(page.getByRole('button', { name: 'Sort projects: Name A–Z' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`person=${bobId}`)) // the person stays chosen
})
