import { expect, test } from '@playwright/test'
import {
  createProjectViaApi,
  createTaskViaApi,
  inviteViaApi,
  loginViaUi,
  newUser,
  openProject,
  titlesIn,
  toggleAssignees,
} from './helpers'

test.describe('working together', () => {
  test('the owner invites someone, who then sees a read-only project but can work on tasks', async ({
    page,
    request,
  }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    const projectId = await createProjectViaApi(request, alice.token, 'Shared work')
    await createTaskViaApi(request, alice.token, projectId, { title: 'Plan the launch' })

    // Alice invites Bob on screen.
    await loginViaUi(page, alice.person)
    await openProject(page, 'Shared work')
    await page.getByRole('button', { name: /^Members \d+$/ }).click()
    await page.getByLabel('Their email').fill(bob.person.email)
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText(`${bob.person.name} was added to the project.`)).toBeVisible()
    const members = page.getByRole('dialog', { name: 'Members' })
    await expect(members.getByText(bob.person.name, { exact: true })).toBeVisible()
    await expect(members.getByRole('button', { name: /^Actions for/ })).toHaveCount(1)
    await page.keyboard.press('Escape')

    // Bob signs in: he is a member, so no owner actions, but the work is his too.
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await page.getByLabel('Email').fill(bob.person.email)
    await page.getByLabel('Password', { exact: true }).fill(bob.person.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await openProject(page, 'Shared work')
    await expect(page.getByText(/Member$/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)
    await page.getByRole('button', { name: /^Members \d+$/ }).click()
    await expect(page.getByText('Only the project owner can invite or remove members.')).toBeVisible()
    await expect(page.getByLabel('Their email')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Plan the launch'])
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByRole('dialog').getByLabel('Title').fill("Bob's idea")
    await page.getByRole('dialog').getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByRole('button', { name: "Bob's idea", exact: true })).toBeVisible()

    // Alice sees what Bob added.
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await page.getByLabel('Email').fill(alice.person.email)
    await page.getByLabel('Password', { exact: true }).fill(alice.person.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await openProject(page, 'Shared work')
    await expect.poll(() => titlesIn(page, /^To do/)).toEqual(['Plan the launch', "Bob's idea"])
  })

  test("inviting an email nobody signed up with explains what to do; inviting twice is refused", async ({
    page,
    request,
  }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    await createProjectViaApi(request, alice.token, 'Team')
    await loginViaUi(page, alice.person)
    await openProject(page, 'Team')
    await page.getByRole('button', { name: /^Members \d+$/ }).click()

    await page.getByLabel('Their email').fill('nobody-here@e2e.test')
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText('No account uses this email. Ask them to sign up first.')).toBeVisible()

    await page.getByLabel('Their email').fill('not an email')
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()

    await page.getByLabel('Their email').fill(bob.person.email)
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText(`${bob.person.name} was added to the project.`)).toBeVisible()
    await page.getByLabel('Their email').fill(bob.person.email)
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByText('This person is already a member.')).toBeVisible()
  })

  test("removing a member takes the project away from them and un-assigns their tasks", async ({
    page,
    request,
  }) => {
    const alice = await newUser(request, 'Alice')
    const bob = await newUser(request, 'Bob')
    const projectId = await createProjectViaApi(request, alice.token, 'Crew')
    const bobId = await inviteViaApi(request, alice.token, projectId, bob.person.email)
    await createTaskViaApi(request, alice.token, projectId, { title: "Bob's job", assigneeIds: [bobId] })

    await loginViaUi(page, alice.person)
    await openProject(page, 'Crew')
    await expect(page.getByTitle(`Assigned to ${bob.person.name}`)).toBeVisible()

    await page.getByRole('button', { name: /^Members \d+$/ }).click()
    await page.getByRole('button', { name: `Actions for ${bob.person.name}` }).click()
    await page.getByRole('menuitem', { name: `Remove: ${bob.person.name}` }).click()
    await page.getByRole('dialog', { name: `Remove ${bob.person.name}` }).getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByText(`${bob.person.name} was removed.`)).toBeVisible()
    // The removed row held the button that had the focus: the keyboard must still work in the panel.
    await expect(page.getByLabel('Their email')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Members' })).toHaveCount(0)
    await expect(page.getByTitle(`Assigned to ${bob.person.name}`)).toHaveCount(0)
    await toggleAssignees(page, ['Unassigned'])
    await expect(page.getByRole('button', { name: "Bob's job", exact: true })).toBeVisible()

    // Bob no longer finds the project.
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await page.getByLabel('Email').fill(bob.person.email)
    await page.getByLabel('Password', { exact: true }).fill(bob.person.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByText('You have no projects yet.')).toBeVisible()
  })
})
