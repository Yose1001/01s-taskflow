import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../../App'
import { BOB, CAROL, fakeBackend, project, type FakeProject } from '../../test/fakeBackend'
import { ME } from '../../test/mockApi'
import { renderApp } from '../../test/render'

const BOB_USER = { ...ME, id: BOB.userId, email: BOB.email, displayName: BOB.displayName }
const ME_AS_MEMBER = { userId: ME.id, email: ME.email, displayName: ME.displayName }

type U = ReturnType<typeof userEvent.setup>

/** Opens the app at `route`, signs in as Alice (the guard sends signed-out visitors to /login first). */
async function openSignedIn(user: U, route = '/') {
  const view = renderApp(<AppRoutes />, { route })
  await user.type(screen.getByLabelText('Email'), 'alice@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  await screen.findByRole('heading', { level: 1, name: 'Hello, Alice' }).catch(() => undefined)
  return view
}

const many = (n: number): FakeProject[] =>
  Array.from({ length: n }, (_, i) =>
    project(`p${i + 1}`, `Project ${String(i + 1).padStart(2, '0')}`),
  )

describe('project list', () => {
  it('shows the projects with name, description, role and date, each linking to its page', async () => {
    fakeBackend({
      projects: [
        project('p1', 'Website', { description: 'Redesign the site' }),
        project('p2', 'Shared work', { owner: BOB_USER, members: [ME_AS_MEMBER] }),
      ],
    })
    await openSignedIn(userEvent.setup())

    const website = await screen.findByRole('link', { name: /Website/ })
    expect(website).toHaveAttribute('href', '/projects/p1')
    expect(within(website).getByText('Redesign the site')).toBeInTheDocument()
    expect(within(website).getByText('Owner')).toBeInTheDocument()
    expect(within(website).getByText('Created 15 Jan 2026')).toBeInTheDocument()

    const shared = screen.getByRole('link', { name: /Shared work/ })
    expect(within(shared).getByText('Member')).toBeInTheDocument()
    expect(within(shared).getByText('No description')).toBeInTheDocument()
  })

  it('shows a friendly empty state with a way to create the first project', async () => {
    fakeBackend()
    await openSignedIn(userEvent.setup())
    expect(await screen.findByText('You have no projects yet.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New project' })).toHaveLength(2) // header and empty state
  })

  it('announces loading, then shows an error with Try again that recovers', async () => {
    let fail = true
    fakeBackend({
      projects: [project('p1', 'Recovered')],
      routes: {
        'GET /projects': () =>
          fail
            ? { status: 500, body: { code: 'internal_error', message: 'x' } }
            : {
                body: {
                  items: [
                    {
                      id: 'p1',
                      name: 'Recovered',
                      description: '',
                      ownerId: ME.id,
                      myRole: 'owner',
                      createdAt: '2026-01-15T00:00:00Z',
                      updatedAt: '',
                      deletedAt: null,
                      purgeAt: null,
                    },
                  ],
                  total: 1,
                },
              },
      },
    })
    const user = userEvent.setup()
    await openSignedIn(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong. Please try again.')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: /Recovered/ })).toBeInTheDocument()
  })

  it('shows text, never HTML, for names and descriptions (no script injection)', async () => {
    fakeBackend({
      projects: [
        project('p1', '<img src=x onerror=alert(1)>', { description: '<script>alert(2)</script>' }),
      ],
    })
    await openSignedIn(userEvent.setup())
    const card = await screen.findByRole('link', { name: /img src/ })
    expect(card).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(card).toHaveTextContent('<script>alert(2)</script>')
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(document.querySelector('script:not([src])')).toBeNull()
  })

  it('pages through long lists (12 per page) and asks the API for the right page', async () => {
    const api = fakeBackend({ projects: many(25) })
    const user = userEvent.setup()
    await openSignedIn(user)

    expect(await screen.findByRole('link', { name: /Project 01/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Project 13/ })).not.toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('link', { name: /Project 13/ })).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(api.to('GET /projects?page=2&pageSize=12')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('link', { name: /Project 25/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('does not trust the page number in the address', async () => {
    const api = fakeBackend({ projects: many(25) })
    await openSignedIn(userEvent.setup(), '/?page=abc')
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    expect(api.to('GET /projects?page=1&pageSize=12').length).toBeGreaterThan(0)
  })

  it.each(['1.5', '1e3', '-2', '0', '0x10', '99999999999'])(
    'never sends the odd page number %s to the API',
    async (odd) => {
      const api = fakeBackend({ projects: many(25) })
      await openSignedIn(userEvent.setup(), `/?page=${odd}`)
      expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
      const paths = new Set(api.hits('GET /projects').map((c) => c.path))
      expect([...paths]).toEqual(['/projects?page=1&pageSize=12'])
    },
  )

  it('moves to the last real page when the page number is past the end', async () => {
    fakeBackend({ projects: many(25) })
    await openSignedIn(userEvent.setup(), '/?page=99')
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Project 25/ })).toBeInTheDocument()
  })

  it('ends the session with an explanation when the API says 401', async () => {
    fakeBackend({
      routes: {
        'GET /projects': () => ({ status: 401, body: { code: 'unauthorized', message: 'x' } }),
      },
    })
    renderApp(<AppRoutes />, { route: '/login' })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Your session ended. Please log in again.')).toBeInTheDocument()
  })

  it('works in Thai too, with Thai dates', async () => {
    fakeBackend({ projects: [project('p1', 'เว็บไซต์')] })
    const user = userEvent.setup()
    await openSignedIn(user)
    await screen.findByRole('link', { name: /เว็บไซต์/ })
    await user.click(screen.getByRole('button', { name: 'ไทย' }))
    expect(screen.getByRole('heading', { level: 2, name: 'โปรเจกต์ของคุณ' })).toBeInTheDocument()
    expect(screen.getByText(/สร้างเมื่อ .*2569/)).toBeInTheDocument() // Buddhist-era year
    expect(screen.getByText('เจ้าของ')).toBeInTheDocument()
  })
})

describe('creating a project', () => {
  async function openDialog(user: U) {
    await screen.findByText('You have no projects yet.')
    await user.click(screen.getAllByRole('button', { name: 'New project' })[0]!)
    return screen.findByRole('dialog', { name: 'New project' })
  }

  it('opens an accessible dialog with focus on the first field', async () => {
    fakeBackend()
    const user = userEvent.setup()
    await openSignedIn(user)
    const dialog = await openDialog(user)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByLabelText('Project name')).toHaveFocus()
  })

  it('closes with Escape and gives the focus back to the button that opened it', async () => {
    fakeBackend()
    const user = userEvent.setup()
    await openSignedIn(user)
    const opener = screen.getAllByRole('button', { name: 'New project' })[0]!
    await openDialog(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps Tab inside the dialog', async () => {
    fakeBackend()
    const user = userEvent.setup()
    await openSignedIn(user)
    const dialog = await openDialog(user)
    const inside = () =>
      within(dialog).getAllByRole('textbox').length + within(dialog).getAllByRole('button').length
    for (let i = 0; i < inside() + 2; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('checks the name and description before calling the server', async () => {
    const api = fakeBackend()
    const user = userEvent.setup()
    await openSignedIn(user)
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(within(dialog).getByText('This field is required.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Project name')).toHaveFocus()

    await user.type(within(dialog).getByLabelText('Project name'), 'x'.repeat(121))
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(within(dialog).getByText('Enter a name of 1 to 120 characters.')).toBeInTheDocument()
    expect(api.hits('POST /projects')).toHaveLength(0)
  })

  it('creates the project, trims the name, and opens its page', async () => {
    const api = fakeBackend()
    const user = userEvent.setup()
    await openSignedIn(user)
    const dialog = await openDialog(user)

    await user.type(within(dialog).getByLabelText('Project name'), '  Launch plan  ')
    await user.type(within(dialog).getByLabelText('Description (optional)'), 'Q1 goals')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Launch plan' }),
    ).toBeInTheDocument()
    expect(api.hits('POST /projects')[0]!.body).toEqual({
      name: 'Launch plan',
      description: 'Q1 goals',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Q1 goals')).toBeInTheDocument()
  })

  it('shows a server-side field error next to the field and keeps the dialog open', async () => {
    fakeBackend({
      routes: {
        'POST /projects': () => ({
          status: 422,
          body: { code: 'validation_failed', message: 'x', fields: { name: 'invalid_name' } },
        }),
      },
    })
    const user = userEvent.setup()
    await openSignedIn(user)
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText('Project name'), 'Fine name')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(
      await within(dialog).findByText('Enter a name of 1 to 120 characters.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows a banner (not a field error) for other failures, and the button recovers', async () => {
    fakeBackend({
      routes: {
        'POST /projects': () => ({ status: 500, body: { code: 'internal_error', message: 'x' } }),
      },
    })
    const user = userEvent.setup()
    await openSignedIn(user)
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText('Project name'), 'Fine name')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled()
  })

  it('adds the new project to the list', async () => {
    fakeBackend()
    const user = userEvent.setup()
    await openSignedIn(user)
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText('Project name'), 'Brand new')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    await screen.findByRole('heading', { level: 1, name: 'Brand new' })
    await user.click(screen.getByRole('link', { name: /Back to projects/ }))
    expect(await screen.findByRole('link', { name: /Brand new/ })).toBeInTheDocument()
  })
})

describe('project page', () => {
  it('shows the details and, for the owner, Edit and Delete', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { description: 'Line one\nLine two' })] })
    await openSignedIn(userEvent.setup(), '/projects/p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Website' })).toBeInTheDocument()
    expect(screen.getByText(/Line one/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('shows a member the project but NO owner actions', async () => {
    fakeBackend({
      projects: [project('p1', 'Team space', { owner: BOB_USER, members: [ME_AS_MEMBER] })],
    })
    await openSignedIn(userEvent.setup(), '/projects/p1')
    await screen.findByRole('heading', { level: 1, name: 'Team space' })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    // the member list itself is visible
    const members = await screen.findByRole('region', { name: 'Members' })
    expect(await within(members).findByText('Bob')).toBeInTheDocument()
  })

  it('says "not found" (without retrying) for a project that is missing or not theirs', async () => {
    const api = fakeBackend({ projects: [project('secret', 'Not yours', { owner: BOB_USER })] })
    await openSignedIn(userEvent.setup(), '/projects/secret')
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute('href', '/')
    expect(screen.queryByText('Not yours')).not.toBeInTheDocument()
    expect(api.hits('GET /projects/secret')).toHaveLength(1) // a 404 is not retried
  })

  it('offers Try again for server errors', async () => {
    fakeBackend({
      projects: [project('p1', 'Website')],
      routes: {
        'GET /projects/p1': () => ({ status: 500, body: { code: 'internal_error', message: 'x' } }),
      },
    })
    await openSignedIn(userEvent.setup(), '/projects/p1')
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('edits the project: prefilled form, only the saved values go to the API', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website', { description: 'Old text' })] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
    expect(within(dialog).getByLabelText('Project name')).toHaveValue('Website')
    expect(within(dialog).getByLabelText('Description (optional)')).toHaveValue('Old text')

    await user.clear(within(dialog).getByLabelText('Project name'))
    await user.type(within(dialog).getByLabelText('Project name'), 'Website v2')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Website v2' })).toBeInTheDocument()
    expect(api.hits('PATCH /projects/p1')[0]!.body).toEqual({
      name: 'Website v2',
      description: 'Old text',
    })
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
  })

  it('deleting asks first; Cancel has the focus and changes nothing', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete this project?' })
    expect(within(dialog).getByText(/"Website" will move to the trash/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus() // the safe choice first
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.hits('DELETE /projects/p1')).toHaveLength(0)
  })

  it('moves the project to the trash, returns to the list, and offers Undo', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website'), project('p2', 'Other')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Move to trash' }),
    )

    expect(await screen.findByText('"Website" moved to the trash.')).toBeInTheDocument()
    expect(api.hits('DELETE /projects/p1')).toHaveLength(1)
    expect(await screen.findByRole('link', { name: /Other/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Website/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('"Website" restored.')).toBeInTheDocument()
    expect(api.hits('POST /projects/p1/restore')).toHaveLength(1)
    expect(await screen.findByRole('link', { name: /Website/ })).toBeInTheDocument()
  })

  it("does not leave one person's messages on screen for the next person who logs in", async () => {
    fakeBackend({ projects: [project('p1', 'Website'), project('p2', 'Other')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Move to trash' }),
    )
    expect(await screen.findByText('"Website" moved to the trash.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { level: 1, name: 'Log in' })
    expect(screen.queryByText('"Website" moved to the trash.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await screen.findByRole('link', { name: /Other/ })
    expect(screen.queryByText('"Website" moved to the trash.')).not.toBeInTheDocument()
  })

  it('shows an error inside the delete dialog when deleting fails', async () => {
    fakeBackend({
      projects: [project('p1', 'Website')],
      routes: {
        'DELETE /projects/:id': () => ({
          status: 500,
          body: { code: 'internal_error', message: 'x' },
        }),
      },
    })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Move to trash' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('heading', { level: 1, name: 'Website' })).toBeInTheDocument() // still here
  })
})

describe('members', () => {
  it('lists members with roles; the owner row has no Remove button', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { members: [BOB] })] })
    await openSignedIn(userEvent.setup(), '/projects/p1')
    const section = await screen.findByRole('region', { name: 'Members' })
    expect(await within(section).findByText('Bob')).toBeInTheDocument()
    expect(within(section).getByText(/Joined 1 Feb 2026/)).toBeInTheDocument()
    expect(within(section).getAllByRole('button', { name: /^Remove/ })).toHaveLength(1)
    expect(within(section).getByRole('button', { name: 'Remove: Bob' })).toBeInTheDocument()
  })

  it('invites by email, clears the box, and shows the new member', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await screen.findByRole('region', { name: 'Members' })
    await user.type(within(section).getByLabelText('Their email'), '  BOB@example.com ')
    await user.click(within(section).getByRole('button', { name: 'Invite' }))

    expect(await within(section).findByText('Bob')).toBeInTheDocument()
    expect(api.hits('POST /projects/p1/members')[0]!.body).toEqual({ email: 'BOB@example.com' })
    expect(within(section).getByLabelText('Their email')).toHaveValue('')
    expect(await screen.findByText('Bob was added to the project.')).toBeInTheDocument()
  })

  it('explains an unknown email in plain words', async () => {
    fakeBackend({ projects: [project('p1', 'Website')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await screen.findByRole('region', { name: 'Members' })
    await user.type(within(section).getByLabelText('Their email'), 'nobody@example.com')
    await user.click(within(section).getByRole('button', { name: 'Invite' }))
    expect(
      await within(section).findByText('No account uses this email. Ask them to sign up first.'),
    ).toBeInTheDocument()
    expect(within(section).getByLabelText('Their email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('says so when the person is already a member', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { members: [BOB] })] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await screen.findByRole('region', { name: 'Members' })
    await user.type(within(section).getByLabelText('Their email'), 'bob@example.com')
    await user.click(within(section).getByRole('button', { name: 'Invite' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'This person is already a member.',
    )
  })

  it('checks the email before calling the server', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await screen.findByRole('region', { name: 'Members' })
    await user.click(within(section).getByRole('button', { name: 'Invite' }))
    expect(within(section).getByText('This field is required.')).toBeInTheDocument()
    await user.type(within(section).getByLabelText('Their email'), 'not-an-email')
    await user.click(within(section).getByRole('button', { name: 'Invite' }))
    expect(within(section).getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(api.hits('POST /projects/p1/members')).toHaveLength(0)
  })

  it('asks before removing, then removes', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website', { members: [BOB, CAROL] })] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await screen.findByRole('region', { name: 'Members' })
    await user.click(await within(section).findByRole('button', { name: 'Remove: Bob' }))

    const dialog = await screen.findByRole('dialog', { name: 'Remove this member?' })
    expect(within(dialog).getByText(/Bob will lose access/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.hits('DELETE /projects/p1/members/' + BOB.userId)).toHaveLength(0)

    await user.click(within(section).getByRole('button', { name: 'Remove: Bob' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove member' }),
    )
    await waitFor(() => expect(within(section).queryByText('Bob')).not.toBeInTheDocument())
    expect(within(section).getByText('Carol')).toBeInTheDocument()
    expect(await screen.findByText('Bob was removed.')).toBeInTheDocument()
  })
})

describe('trash', () => {
  it('is reachable from the list and shows when each project will be removed for good', async () => {
    const deletedAt = new Date().toISOString()
    fakeBackend({ projects: [project('p1', 'Old idea', { deletedAt }), project('p2', 'Kept')] })
    const user = userEvent.setup()
    await openSignedIn(user)
    await screen.findByRole('link', { name: /Kept/ })
    expect(screen.queryByRole('link', { name: /Old idea/ })).not.toBeInTheDocument() // not in the normal list

    await user.click(screen.getByRole('link', { name: 'Trash' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument()
    const item = (await screen.findByRole('heading', { name: 'Old idea' })).closest('li')!
    expect(within(item).getByText(/Removed for good on/)).toBeInTheDocument()
    expect(within(item).getByText(/Days left: (29|30)/)).toBeInTheDocument()
  })

  it('restores a project and tells the person', async () => {
    const api = fakeBackend({
      projects: [project('p1', 'Old idea', { deletedAt: new Date().toISOString() })],
    })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/trash')
    await user.click(await screen.findByRole('button', { name: 'Restore: Old idea' }))

    expect(await screen.findByText('"Old idea" restored.')).toBeInTheDocument()
    expect(api.hits('POST /projects/p1/restore')).toHaveLength(1)
    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing in the trash', async () => {
    fakeBackend({ projects: [project('p1', 'Kept')] })
    await openSignedIn(userEvent.setup(), '/projects/trash')
    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument()
  })

  it('shows an error when restoring fails, and keeps the item', async () => {
    fakeBackend({
      projects: [project('p1', 'Old idea', { deletedAt: new Date().toISOString() })],
      routes: {
        'POST /projects/:id/restore': () => ({
          status: 404,
          body: { code: 'not_found', message: 'x' },
        }),
      },
    })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/trash')
    await user.click(await screen.findByRole('button', { name: 'Restore: Old idea' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not find what you were looking for.',
    )
    expect(screen.getByRole('heading', { name: 'Old idea' })).toBeInTheDocument()
  })
})

describe('privacy between people on the same browser', () => {
  it('throws away everything fetched for one person when they log out', async () => {
    fakeBackend({ projects: [project('p1', 'Alice private plan')] })
    const user = userEvent.setup()
    const { queryClient } = await openSignedIn(user)
    await screen.findByRole('link', { name: /Alice private plan/ })
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { level: 1, name: 'Log in' })

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(screen.queryByText('Alice private plan')).not.toBeInTheDocument()
  })

  it("does not show the previous person's projects to the next person, even for a moment", async () => {
    fakeBackend({ projects: [project('p1', 'Alice private plan')] })
    const user = userEvent.setup()
    await openSignedIn(user)
    await screen.findByRole('link', { name: /Alice private plan/ })
    await user.click(screen.getByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { level: 1, name: 'Log in' })

    // Bob signs in on the same browser. His server answers slowly, so any leftover data would be visible.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    fakeBackend({
      me: BOB_USER,
      projects: [project('b1', 'Bob own work', { owner: BOB_USER })],
      routes: { 'GET /projects': async () => (await gate, { body: { items: [], total: 0 } }) },
    })
    await user.type(screen.getByLabelText('Email'), 'bob@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await screen.findByRole('heading', { level: 1, name: 'Hello, Bob' })
    expect(screen.queryByText('Alice private plan')).not.toBeInTheDocument()
    release()
  })
})
