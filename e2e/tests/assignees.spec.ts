import { expect, test } from '@playwright/test'
import { createProjectViaApi, inviteViaApi, loginViaUi, newUser, openProject, pickDay, toggleAssignees } from './helpers'

test.use({ viewport: { width: 1400, height: 900 } })

test.describe('several people and two dates on a task', () => {
  test('a task is shared by two people, has a start and an end, and survives one of them leaving', async ({
    page,
    request,
  }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    const projectId = await createProjectViaApi(request, alice.token, 'Crew')
    await inviteViaApi(request, alice.token, projectId, bob.person.email)

    await loginViaUi(page, alice.person)
    await openProject(page, 'Crew')
    await page.getByRole('button', { name: 'New task' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Title').fill('Shared job')
    await form.getByRole('checkbox', { name: alice.person.email }).check()
    await form.getByRole('checkbox', { name: bob.person.email }).check()

    // The end date's calendar starts at the start date, and the days before it cannot be chosen.
    const year = new Date().getFullYear() + 1
    await pickDay(page, 'Start date (optional)', `${year}-02-02`)
    await form.getByLabel('End date (optional)', { exact: true }).click()
    const calendar = page.getByRole('dialog', { name: 'End date (optional)' })
    await expect(calendar.getByRole('grid', { name: `February ${year}` })).toBeVisible()
    await expect(calendar.locator(`[data-day="${year}-02-01"]`)).toHaveAttribute('aria-disabled', 'true')
    await calendar.getByLabel('Month', { exact: true }).selectOption('2')
    await calendar.locator(`[data-day="${year}-03-01"]`).click()
    await form.getByRole('button', { name: 'Create task' }).click()
    await expect(form).toHaveCount(0)

    const both = [alice.person.email, bob.person.email].sort().join(', ')
    await expect(page.getByTitle(`Assigned to ${both}`)).toBeVisible()
    await expect(page.getByText('+1', { exact: true })).toBeVisible()
    await expect(page.locator(`time[datetime="${year}-02-02"]`)).toBeVisible()
    await expect(page.locator(`time[datetime="${year}-03-01"]`)).toBeVisible()

    // Everything is really saved, and the filter finds the task under each person.
    await page.reload()
    await toggleAssignees(page, [bob.person.email])
    await expect(page.getByRole('button', { name: 'Shared job', exact: true })).toBeVisible()
    await toggleAssignees(page, [bob.person.email, alice.person.email])
    await expect(page.getByRole('button', { name: 'Shared job', exact: true })).toBeVisible()
    await toggleAssignees(page, [alice.person.email, 'Unassigned'])
    await expect(page.getByRole('button', { name: 'Shared job', exact: true })).toHaveCount(0)
    await toggleAssignees(page, ['All'])

    // Bob leaves: Alice is still on the task.
    await page.getByRole('button', { name: /^Members \d+$/ }).click()
    await page.getByRole('button', { name: `Actions for ${bob.person.email}` }).click()
    await page.getByRole('menuitem', { name: `Remove: ${bob.person.email}` }).click()
    await page.getByRole('dialog', { name: `Remove ${bob.person.email}` }).getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByText(`${bob.person.email} was removed.`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTitle(`Assigned to ${alice.person.email}`)).toBeVisible()
  })
})
