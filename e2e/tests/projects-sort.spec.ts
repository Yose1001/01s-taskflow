import { expect, test } from '@playwright/test'
import { createProjectViaApi, createTaskViaApi, loginViaUi, newUser } from './helpers'

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
