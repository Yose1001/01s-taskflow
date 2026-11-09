import { expect, test, type Page } from '@playwright/test'
import {
  boardOnServer,
  createProjectViaApi,
  createTaskViaApi,
  loginViaUi,
  newUser,
  openProject,
  reloadSignedIn,
  titlesIn,
} from './helpers'

test.use({ viewport: { width: 1400, height: 1000 } })

const handle = (page: Page, title: string) => page.getByRole('button', { name: `Move task: ${title}` })

async function setUp(page: Page, request: Parameters<typeof newUser>[0]) {
  const { person, token } = await newUser(request, 'Alice')
  const projectId = await createProjectViaApi(request, token, 'Website')
  await createTaskViaApi(request, token, projectId, { title: 'Check the API', status: 'review' })
  await loginViaUi(page, person)
  await openProject(page, 'Website')
  await expect(page.getByRole('region', { name: /^In review, 1/ })).toBeVisible()
  return { token, projectId }
}

test.describe('putting a task on hold', () => {
  test('moving a card there asks why, shows the reason, and clears it on the way out', async ({ page, request }) => {
    const { token, projectId } = await setUp(page, request)

    // With a real mouse, picked up by the card itself.
    const from = (await page.getByRole('button', { name: 'Check the API', exact: true }).boundingBox())!
    const to = (await page.getByRole('region', { name: /^On hold/ }).getByRole('list').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 })
    await page.mouse.up()

    const dialog = page.getByRole('dialog', { name: 'Put on hold: Check the API' })
    await expect(dialog).toBeVisible()

    // A reason is required, and Cancel leaves the card where it was.
    await dialog.getByRole('button', { name: 'Put on hold' }).click()
    await expect(dialog.getByText('Enter why this task is on hold.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Check the API'])

    // This time with the keyboard, and with a reason.
    await handle(page, 'Check the API').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Check the API" is over In review.')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Check the API" is over On hold.')
    await page.keyboard.press('Space')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Why is it on hold?').fill('Waiting for the other team')
    await dialog.getByRole('button', { name: 'Put on hold' }).click()
    await expect(dialog).toHaveCount(0)

    await expect.poll(() => titlesIn(page, /^On hold/)).toEqual(['Check the API'])
    await expect(page.getByText('Waiting for the other team')).toBeVisible()
    await expect(handle(page, 'Check the API')).toBeFocused() // the keyboard stays with the card
    await expect.poll(async () => (await boardOnServer(request, token, projectId)).on_hold).toEqual(['Check the API'])

    await reloadSignedIn(page)
    await expect(page.getByText('Waiting for the other team')).toBeVisible()

    // Out again: the reason is gone, and coming back asks for a new one.
    await handle(page, 'Check the API').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Check the API" is over On hold.')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Check the API" is over Done.')
    await page.keyboard.press('Space')
    await expect.poll(() => titlesIn(page, /^Done/)).toEqual(['Check the API'])
    await expect(page.getByText('Waiting for the other team')).toHaveCount(0)
  })

  test('the task form can put a task on hold and change the reason', async ({ page, request }) => {
    await setUp(page, request)

    await page.getByRole('button', { name: 'Check the API', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Edit task' })
    await expect(form.getByLabel('Why is it on hold?')).toHaveCount(0)
    await form.getByLabel('Column').selectOption('on_hold')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(form.getByText('Enter why this task is on hold.')).toBeVisible()
    await form.getByLabel('Why is it on hold?').fill('First reason')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(form).toHaveCount(0)
    await expect.poll(() => titlesIn(page, /^On hold/)).toEqual(['Check the API'])
    await expect(page.getByText('First reason')).toBeVisible()

    await page.getByRole('button', { name: 'Check the API', exact: true }).click()
    await expect(form.getByLabel('Why is it on hold?')).toHaveValue('First reason')
    await form.getByLabel('Why is it on hold?').fill('Second reason')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Second reason')).toBeVisible()
  })
})
