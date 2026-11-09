import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  pickDay,
  boardOnServer,
  createProjectViaApi,
  createTaskViaApi,
  loginViaUi,
  newUser,
  openProject,
  reloadSignedIn,
  titlesIn,
} from './helpers'

// A wide and tall window: the five columns sit side by side like on a real desktop, and the whole board
// is on screen, so the page never scrolls by itself during a drag (which would move the drop target).
test.use({ viewport: { width: 1400, height: 1300 } })

const card = (page: Page, title: string) => page.getByRole('button', { name: title, exact: true })
const handle = (page: Page, title: string) => page.getByRole('button', { name: `Move task: ${title}` })

/** Drags with a real mouse: press, wiggle a little (so it counts as a drag), glide to the target, release. */
async function dragWithMouse(page: Page, from: Locator, to: Locator, where: 'top' | 'middle' | 'bottom' = 'middle') {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  const targetY = where === 'top' ? b.y + 6 : where === 'bottom' ? b.y + b.height - 6 : b.y + b.height / 2
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, targetY, { steps: 25 })
  await page.mouse.up()
}

async function setUpBoard(page: Page, request: Parameters<typeof newUser>[0]) {
  const { person, token } = await newUser(request, 'Alice')
  const projectId = await createProjectViaApi(request, token, 'Website')
  for (const t of [
    { title: 'Draw logo', priority: 'high' as const },
    { title: 'Write copy' },
    { title: 'Pick colors' },
    { title: 'Build header', status: 'in_progress' as const },
    { title: 'Review checkout', status: 'review' as const },
    { title: 'Buy domain', status: 'done' as const },
  ])
    await createTaskViaApi(request, token, projectId, t)
  await loginViaUi(page, person)
  await openProject(page, 'Website')
  await expect(page.getByRole('region', { name: /^To do, 3/ })).toBeVisible()
  return { person, token, projectId }
}

test.describe('the task board', () => {
  test('shows the tasks in five columns, in order', async ({ page, request }) => {
    await setUpBoard(page, request)
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Draw logo', 'Write copy', 'Pick colors'])
    await expect.poll(() => titlesIn(page, /^In progress/)).toEqual(['Build header'])
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Review checkout'])
    await expect.poll(() => titlesIn(page, /^Done/)).toEqual(['Buy domain'])
  })

  test('dragging a card with the mouse into another column keeps it there after a reload', async ({
    page,
    request,
  }) => {
    const { person, token, projectId } = await setUpBoard(page, request)

    await dragWithMouse(page, handle(page, 'Write copy'), page.getByRole('region', { name: /^In review/ }).getByRole('list'), 'bottom')
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Review checkout', 'Write copy'])
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Draw logo', 'Pick colors'])

    // The server has the same picture, and it survives a reload.
    await expect
      .poll(async () => (await boardOnServer(request, token, projectId)).review)
      .toEqual(['Review checkout', 'Write copy'])
    await reloadSignedIn(page)
    await expect(page.getByRole('region', { name: /^In review, 2/ })).toBeVisible()
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Review checkout', 'Write copy'])
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Draw logo', 'Pick colors'])
  })

  test('with a mouse a card can be picked up anywhere on it, and that does not open it', async ({ page, request }) => {
    await setUpBoard(page, request)
    const review = page.getByRole('region', { name: /^In review/ }).getByRole('list')

    // By its title...
    await dragWithMouse(page, card(page, 'Write copy'), review, 'bottom')
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Review checkout', 'Write copy'])
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // ...and by the row at the bottom of the card, which is not a button at all.
    const bottomRow = page.getByRole('listitem').filter({ hasText: 'Pick colors' }).getByText('Unassigned').first()
    await dragWithMouse(page, bottomRow, review, 'bottom')
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Review checkout', 'Write copy', 'Pick colors'])
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('dragging onto the top of a card in another column puts it in front of that card', async ({
    page,
    request,
  }) => {
    const { token, projectId } = await setUpBoard(page, request)
    await dragWithMouse(page, handle(page, 'Pick colors'), card(page, 'Build header'), 'top')
    await expect.poll(() => titlesIn(page, /^In progress/)).toEqual(['Pick colors', 'Build header'])
    await expect
      .poll(async () => (await boardOnServer(request, token, projectId)).in_progress)
      .toEqual(['Pick colors', 'Build header'])
  })

  test('dragging inside a column re-orders it', async ({ page, request }) => {
    const { token, projectId } = await setUpBoard(page, request)
    await dragWithMouse(page, handle(page, 'Draw logo'), card(page, 'Pick colors'), 'bottom')
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Write copy', 'Pick colors', 'Draw logo'])
    await expect
      .poll(async () => (await boardOnServer(request, token, projectId)).todo)
      .toEqual(['Write copy', 'Pick colors', 'Draw logo'])
  })

  test('the same can be done with the keyboard only, and it is announced', async ({ page, request }) => {
    const { token, projectId } = await setUpBoard(page, request)

    await handle(page, 'Build header').focus()
    await page.keyboard.press('Space') // pick up
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Build header" is over In progress.')
    await page.keyboard.press('ArrowRight') // one column to the right
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Build header" is over In review.')
    await page.keyboard.press('Space') // drop
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('"Build header" dropped in In review.')
    await expect(page.getByRole('dialog')).toHaveCount(0) // moving a card does not open it

    await expect.poll(() => titlesIn(page, /^In review/)).toContain('Build header')
    await expect
      .poll(async () => (await boardOnServer(request, token, projectId)).review)
      .toContain('Build header')
  })

  test('one arrow press is one column, to the left as well', async ({ page, request }) => {
    await setUpBoard(page, request)
    await handle(page, 'Build header').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Build header" is over In progress.')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('"Build header" is over To do.')
    await page.keyboard.press('Escape')
  })

  test('a column can be sorted, which changes the view but not the arranged order', async ({ page, request }) => {
    const { token, projectId } = await setUpBoard(page, request)
    const before = (await boardOnServer(request, token, projectId)).todo!

    await page.getByRole('button', { name: /^Sort To do/ }).click()
    await page.getByRole('menuitemradio', { name: 'Newest first' }).click()
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual([...before].reverse())
    expect((await boardOnServer(request, token, projectId)).todo).toEqual(before)

    await page.reload() // remembered on this device
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual([...before].reverse())

    await page.getByRole('button', { name: /^Sort To do/ }).click()
    await page.getByRole('menuitemradio', { name: 'My order' }).click()
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(before)
  })

  test('Escape cancels a keyboard drag and nothing moves', async ({ page, request }) => {
    const { token, projectId } = await setUpBoard(page, request)
    await handle(page, 'Build header').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('cancelled')
    await expect.poll(() => titlesIn(page, /^In progress/)).toEqual(['Build header'])
    expect((await boardOnServer(request, token, projectId)).in_progress).toEqual(['Build header'])
  })

  test('a plain click on a card opens it for editing (it is not mistaken for a drag)', async ({ page, request }) => {
    await setUpBoard(page, request)
    await card(page, 'Draw logo').click()
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
    await expect(page.getByLabel('Title')).toHaveValue('Draw logo')
  })

  test('create a task, edit it, move it with the column menu, then delete it with Undo and restore it from the trash', async ({
    page,
    request,
  }) => {
    await setUpBoard(page, request)

    // Create, choosing the "In review" column in the form
    await page.getByRole('button', { name: 'New task' }).click()
    const create = page.getByRole('dialog', { name: 'New task' })
    await create.getByLabel('Column').selectOption('review')
    await create.getByLabel('Title').fill('  ทดสอบระบบสั่งซื้อ  ')
    await create.getByLabel('Priority').selectOption('High')
    await pickDay(page, 'End date (optional)', `${new Date().getFullYear() - 1}-01-02`)
    await create.getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByText('Task created.')).toBeVisible()
    await expect.poll(() => titlesIn(page, /^In review/)).toEqual(['Review checkout', 'ทดสอบระบบสั่งซื้อ'])
    await expect(page.getByText('Overdue', { exact: true })).toBeVisible() // marked with words, not only color

    // Edit
    await card(page, 'ทดสอบระบบสั่งซื้อ').click()
    const edit = page.getByRole('dialog', { name: 'Edit task' })
    await edit.getByLabel('Title').fill('Test the order system')
    await edit.getByLabel('Column').selectOption('Done')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Task saved.')).toBeVisible()
    await expect.poll(() => titlesIn(page, /^Done/)).toEqual(['Buy domain', 'Test the order system'])
    await expect(page.getByText(/Overdue/)).toHaveCount(0) // finished tasks are never overdue

    // Delete: asks first, then Undo
    await card(page, 'Test the order system').click()
    await page.getByRole('dialog', { name: 'Edit task' }).getByRole('button', { name: 'Delete' }).click()
    const confirm = page.getByRole('dialog', { name: /^Delete task "/ })
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await confirm.getByRole('button', { name: 'Move to trash' }).click()
    await expect(card(page, 'Test the order system')).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(card(page, 'Test the order system')).toBeVisible()

    // Delete again and restore from the task trash page
    await card(page, 'Test the order system').click()
    await page.getByRole('dialog', { name: 'Edit task' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click()
    await page.getByRole('link', { name: 'Trash' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Task trash' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Test the order system' })).toBeVisible()
    await expect(page.getByText(/Days left: 30/)).toBeVisible()
    await page.getByRole('button', { name: 'Restore: Test the order system' }).click()
    await expect(page.getByText('The trash is empty.')).toBeVisible()
    await page.getByRole('link', { name: /Back to the board/ }).click()
    await expect(card(page, 'Test the order system')).toBeVisible()
  })

  test('the task form checks the title and shows problems next to the fields', async ({ page, request }) => {
    await setUpBoard(page, request)
    await page.getByRole('button', { name: 'New task' }).click()
    const dialog = page.getByRole('dialog', { name: 'New task' })
    await dialog.getByRole('button', { name: 'Create task' }).click()
    await expect(dialog.getByText('This field is required.')).toBeVisible()
    await expect(dialog.getByLabel('Title')).toBeFocused()
    await dialog.getByLabel('Title').fill('x'.repeat(201))
    await dialog.getByRole('button', { name: 'Create task' }).click()
    await expect(dialog.getByText('Enter a title of 1 to 200 characters.')).toBeVisible()
  })

  test('task titles are shown as plain text, never run as HTML', async ({ page, request }) => {
    const { person, token } = await newUser(request, 'Mallory')
    const projectId = await createProjectViaApi(request, token, 'Sandbox')
    await createTaskViaApi(request, token, projectId, { title: '<img src=x onerror="window.__hacked=1"><b>x</b>' })
    await loginViaUi(page, person)
    await openProject(page, 'Sandbox')
    await expect(page.getByText('<img src=x onerror="window.__hacked=1"><b>x</b>')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __hacked?: number }).__hacked)).toBeUndefined()
    await expect(page.locator('li img, li b')).toHaveCount(0)
  })
})
