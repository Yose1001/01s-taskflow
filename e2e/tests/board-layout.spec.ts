import { expect, test } from '@playwright/test'
import { createProjectViaApi, loginViaUi, newUser, openProject } from './helpers'

test.use({ viewport: { width: 1440, height: 900 } })

test('a wide screen can show two columns per row, and this device remembers the choice', async ({ page, request }) => {
  const { person, token } = await newUser(request, 'Alice')
  await createProjectViaApi(request, token, 'Website')
  await loginViaUi(page, person)
  await openProject(page, 'Website')

  const box = async (name: RegExp) => (await page.getByRole('region', { name }).boundingBox())!

  // All five in one row at first.
  await expect(page.getByRole('region', { name: /^To do/ })).toBeVisible()
  expect((await box(/^To do/)).y).toBe((await box(/^Done/)).y)

  await page.getByRole('button', { name: 'Two per row' }).click()
  await expect
    .poll(async () => (await box(/^In review/)).x)
    .toBe((await box(/^To do/)).x)
  expect((await box(/^In progress/)).y).toBe((await box(/^To do/)).y)
  expect((await box(/^In review/)).y).toBeGreaterThan((await box(/^To do/)).y)
  // The last column fills its row.
  expect((await box(/^Done/)).width).toBeGreaterThan((await box(/^To do/)).width * 2)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Two per row' })).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(async () => (await box(/^In review/)).x)
    .toBe((await box(/^To do/)).x)
})

test('smaller screens have no such choice', async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const { person, token } = await newUser(request, 'Alice')
  await createProjectViaApi(request, token, 'Website')
  await loginViaUi(page, person)
  await openProject(page, 'Website')
  await expect(page.getByRole('region', { name: /^To do/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Two per row' })).toBeHidden()
})
