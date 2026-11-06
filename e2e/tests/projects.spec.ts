import { expect, test } from '@playwright/test'
import { createProjectViaApi, loginViaUi, newUser, openProject } from './helpers'

test.describe('projects', () => {
  test('create, edit, delete with Undo, and restore from the trash', async ({ page, request }) => {
    const { person } = await newUser(request, 'Alice')
    await loginViaUi(page, person)

    // Create (Thai text and a stray space on purpose)
    await page.getByRole('button', { name: 'New project' }).first().click()
    const create = page.getByRole('dialog', { name: 'New project' })
    await create.getByLabel('Project name').fill('  เว็บไซต์ร้านกาแฟ  ')
    await create.getByLabel('Description (optional)').fill('Redesign and launch')
    await create.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'เว็บไซต์ร้านกาแฟ' })).toBeVisible()
    await expect(page.getByText(/Owner$/).first()).toBeVisible() // the badge (also in the member list)

    // Edit
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit project' })
    await expect(edit.getByLabel('Project name')).toHaveValue('เว็บไซต์ร้านกาแฟ') // trimmed
    await edit.getByLabel('Project name').fill('Coffee shop site')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Coffee shop site' })).toBeVisible()
    await expect(page.getByText('Changes saved.')).toBeVisible()

    // Delete: it asks first, Cancel changes nothing
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete this project?' })
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Coffee shop site' })).toBeVisible()

    // Delete for real, then Undo from the toast
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click()
    await expect(page.getByRole('heading', { level: 1, name: /^Hello/ })).toBeVisible()
    await expect(page.getByText('You have no projects yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('link', { name: /Coffee shop site/ })).toBeVisible()

    // Delete again, then restore it from the Trash page
    await openProject(page, 'Coffee shop site')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click()
    await page.getByRole('link', { name: 'Trash' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Coffee shop site' })).toBeVisible()
    await expect(page.getByText(/Days left: 30/)).toBeVisible()
    await page.getByRole('button', { name: 'Restore: Coffee shop site' }).click()
    await expect(page.getByText('The trash is empty.')).toBeVisible()
    await page.getByRole('link', { name: /Back to projects/ }).click()
    await expect(page.getByRole('link', { name: /Coffee shop site/ })).toBeVisible()
  })

  test('the project form checks the name and shows the problem next to the field', async ({ page, request }) => {
    const { person } = await newUser(request, 'Bob')
    await loginViaUi(page, person)
    await page.getByRole('button', { name: 'New project' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New project' })

    await dialog.getByRole('button', { name: 'Create project' }).click()
    await expect(dialog.getByText('This field is required.')).toBeVisible()
    await expect(dialog.getByLabel('Project name')).toBeFocused()

    await dialog.getByLabel('Project name').fill('x'.repeat(121))
    await dialog.getByRole('button', { name: 'Create project' }).click()
    await expect(dialog.getByText('Enter a name of 1 to 120 characters.')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'New project' }).first()).toBeFocused() // focus returns
  })

  test('long lists are split into pages of 12', async ({ page, request }) => {
    const { person, token } = await newUser(request, 'Carol')
    for (let i = 1; i <= 14; i++) await createProjectViaApi(request, token, `Project ${String(i).padStart(2, '0')}`)
    await loginViaUi(page, person)

    await expect(page.getByText('Page 1 of 2')).toBeVisible()
    await expect(page.getByRole('link', { name: /Project/ })).toHaveCount(12)
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText('Page 2 of 2')).toBeVisible()
    await expect(page.getByRole('link', { name: /Project/ })).toHaveCount(2)
    await expect(page).toHaveURL(/page=2/)
  })

  test("someone else's project looks exactly like a project that does not exist", async ({ page, request }) => {
    const owner = await newUser(request, 'Dana')
    const projectId = await createProjectViaApi(request, owner.token, 'Private plans')
    const stranger = await newUser(request, 'Eli')

    await page.goto(`/projects/${projectId}`) // asks to log in first, then goes there
    await page.getByLabel('Email').fill(stranger.person.email)
    await page.getByLabel('Password', { exact: true }).fill(stranger.person.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByText('Project not found')).toBeVisible()
    await expect(page.getByText('Private plans')).toHaveCount(0)

    await expect(page.getByRole('link', { name: /Back to projects/ })).toBeVisible()
  })

  test('names and descriptions are shown as plain text, never run as HTML', async ({ page, request }) => {
    const { person, token } = await newUser(request, 'Fay')
    await createProjectViaApi(request, token, '<img src=x onerror="window.__hacked=1">', '<b>bold?</b>')
    let dialogs = 0
    page.on('dialog', (d) => {
      dialogs++
      void d.dismiss()
    })
    await loginViaUi(page, person)
    await expect(page.getByText('<img src=x onerror="window.__hacked=1">')).toBeVisible()
    await expect(page.getByText('<b>bold?</b>')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __hacked?: number }).__hacked)).toBeUndefined()
    expect(dialogs).toBe(0)
  })
})
