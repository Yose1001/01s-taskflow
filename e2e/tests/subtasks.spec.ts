import { expect, test } from '@playwright/test'
import { createProjectViaApi, createTaskViaApi, inviteViaApi, loginViaUi, newUser, openProject, reloadSignedIn } from './helpers'

test.use({ viewport: { width: 1400, height: 1000 } })

test.describe('subtasks', () => {
  test('a task is created with subtasks, ticked off one by one, and it all survives a reload', async ({ page, request }) => {
    const { person, token } = await newUser(request, 'Alice')
    await createProjectViaApi(request, token, 'Website')
    await loginViaUi(page, person)
    await openProject(page, 'Website')

    await page.getByRole('button', { name: 'New task' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Title', { exact: true }).fill('Backend')
    const box = form.getByLabel('Add a subtask')
    await box.fill('API route 1')
    await box.press('Enter') // adds a line and does not submit the form
    await expect(form.getByRole('button', { name: 'Create task' })).toBeVisible()
    // One left in the box is not lost when the task is created.
    await box.fill('API route 2')
    await form.getByRole('button', { name: 'Create task' }).click()
    await expect(form).toHaveCount(0)

    const card = page.getByRole('listitem').filter({ hasText: 'Backend' })
    await expect(card.getByText('0/2')).toBeVisible()

    // A tick is saved at once: the card behind the dialog follows, and Cancel does not undo it.
    await page.getByRole('button', { name: 'Backend', exact: true }).click()
    const edit = page.getByRole('dialog')
    await edit.getByRole('checkbox', { name: 'Done: API route 1' }).check()
    await expect(edit.getByText('1/2')).toBeVisible()
    await edit.getByRole('button', { name: 'Cancel' }).click()
    await expect(card.getByText('1/2')).toBeVisible()

    await reloadSignedIn(page)
    await expect(card.getByText('1/2')).toBeVisible()

    // Add, rename and remove on the saved task.
    await page.getByRole('button', { name: 'Backend', exact: true }).click()
    await edit.getByLabel('Add a subtask').fill('API route 3')
    await edit.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(edit.getByRole('textbox', { name: 'Rename subtask: API route 3' })).toBeVisible()
    await expect(edit.getByLabel('Add a subtask')).toHaveValue('')

    await edit.getByRole('textbox', { name: 'Rename subtask: API route 2' }).fill('GET /users')
    await edit.getByRole('textbox', { name: 'Rename subtask: API route 2' }).press('Enter')
    await expect(edit.getByRole('checkbox', { name: 'Done: GET /users' })).toBeVisible()

    await edit.getByRole('button', { name: 'Remove subtask: API route 1' }).click()
    await expect(edit.getByRole('checkbox', { name: 'Done: API route 1' })).toHaveCount(0)
    await expect(edit.getByLabel('Add a subtask')).toBeFocused() // the keyboard stays inside the dialog
    await page.keyboard.press('Escape')
    await expect(edit).toHaveCount(0)
    await expect(card.getByText('0/2')).toBeVisible()

    await reloadSignedIn(page)
    await expect(card.getByText('0/2')).toBeVisible()
    await page.getByRole('button', { name: 'Backend', exact: true }).click()
    await expect(edit.getByRole('checkbox', { name: 'Done: GET /users' })).toBeVisible()
    await expect(edit.getByRole('checkbox', { name: 'Done: API route 3' })).toBeVisible()
  })

  test('a member can tick off subtasks too', async ({ page, request }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    const projectId = await createProjectViaApi(request, alice.token, 'Crew')
    await inviteViaApi(request, alice.token, projectId, bob.person.email)
    await createTaskViaApi(request, alice.token, projectId, { title: 'Backend', subtasks: ['API route 1'] })

    await loginViaUi(page, bob.person)
    await openProject(page, 'Crew')
    await page.getByRole('button', { name: 'Backend', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Done: API route 1' }).check()
    await expect(page.getByRole('dialog').getByText('1/1')).toBeVisible()
  })
})
