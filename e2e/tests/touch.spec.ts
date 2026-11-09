import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { createProjectViaApi, createTaskViaApi, loginViaUi, newUser, openProject, titlesIn } from './helpers'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const middleOf = async (target: Locator) => {
  const box = (await target.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Real touches, sent the way a phone sends them. Playwright's own touch API can only tap. */
const finger = (cdp: CDPSession) => ({
  down: (x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
  move: (x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }),
  up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
})

async function setUp(page: Page, request: Parameters<typeof newUser>[0]) {
  const { person, token } = await newUser(request, 'Alice')
  const projectId = await createProjectViaApi(request, token, 'Website')
  for (const title of ['Draw logo', 'Write copy']) await createTaskViaApi(request, token, projectId, { title })
  await loginViaUi(page, person)
  await openProject(page, 'Website')
  await expect(page.getByRole('region', { name: /^To do, 2/ })).toBeVisible()
  return finger(await page.context().newCDPSession(page))
}

const bottomRow = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ hasText: title }).getByText('Unassigned').first()

test.describe('moving a card with a finger', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'real touches are sent through Chromium only')

  test('a long press anywhere on a card picks it up', async ({ page, request }) => {
    const touch = await setUp(page, request)
    const from = await middleOf(bottomRow(page, 'Draw logo'))
    const to = await middleOf(bottomRow(page, 'Write copy'))

    await touch.down(from.x, from.y)
    await page.waitForTimeout(400)
    for (let i = 1; i <= 10; i++) await touch.move(from.x, from.y + ((to.y - from.y + 20) * i) / 10)
    await touch.up()

    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Write copy', 'Draw logo'])
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('dropping in another column stays there, so the moved card is still in view', async ({ page, request }) => {
    const touch = await setUp(page, request)
    const from = await middleOf(bottomRow(page, 'Draw logo'))

    // Hold at the right edge until the board has moved on, then let go in the middle of the screen.
    await touch.down(from.x, from.y)
    await page.waitForTimeout(400)
    for (let i = 1; i <= 8; i++) await touch.move(from.x + ((385 - from.x) * i) / 8, from.y)
    await page.waitForTimeout(900)
    await touch.move(200, from.y)
    await page.waitForTimeout(200)
    await touch.up()

    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Write copy'])
    const moved = page.getByRole('button', { name: 'Draw logo', exact: true })
    await expect
      .poll(async () => {
        const box = (await moved.boundingBox())!
        return box.x >= 0 && box.x + box.width <= 390
      })
      .toBe(true)
  })

  test('a finger that moves straight away does not pick up a card', async ({ page, request }) => {
    const touch = await setUp(page, request)
    const from = await middleOf(bottomRow(page, 'Draw logo'))
    const to = await middleOf(bottomRow(page, 'Write copy'))

    await touch.down(from.x, from.y)
    for (let i = 1; i <= 10; i++) await touch.move(from.x, from.y + ((to.y - from.y + 20) * i) / 10)
    await page.waitForTimeout(400)
    await touch.up()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Draw logo', 'Write copy'])
  })

  test('a quick tap still opens the card', async ({ page, request }) => {
    await setUp(page, request)
    const at = await middleOf(bottomRow(page, 'Draw logo'))
    await page.touchscreen.tap(at.x, at.y)
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
