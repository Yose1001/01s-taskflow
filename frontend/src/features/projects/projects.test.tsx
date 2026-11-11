import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../../App'
import { BOB, CAROL, fakeBackend, project, task, type FakeProject } from '../../test/fakeBackend'
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
  await screen.findByRole('heading', { name: 'Hello, Alice' }).catch(() => undefined)
  return view
}

const many = (n: number): FakeProject[] =>
  Array.from({ length: n }, (_, i) =>
    project(`p${i + 1}`, `Project ${String(i + 1).padStart(2, '0')}`),
  )

/** "Delete project" is the last item of the project's "More actions" menu. */
async function chooseDelete(user: U) {
  await user.click(await screen.findByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete project' }))
}

/** The member list opens from the project header. */
async function openMembers(user: U) {
  await user.click(await screen.findByRole('button', { name: /^Members \d+$/ }))
  return screen.findByRole('dialog', { name: 'Members' })
}

describe('project list', () => {
  it('on a phone, keeps the order and the view in one ⋯ menu', async () => {
    fakeBackend({ projects: [project('p1', 'Website'), project('p2', 'Shop')] })
    const user = userEvent.setup()
    await openSignedIn(user)
    await screen.findByRole('link', { name: /Website/ })
    await user.click(screen.getByRole('button', { name: 'List options' }))
    expect(screen.getByRole('menuitemradio', { name: 'Sort by: Newest first' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Project view: List' }))
    expect(localStorage.getItem('tf-projects-view')).toBe('list')
    await user.click(screen.getByRole('button', { name: 'List options' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Sort by: Oldest first' }))
    expect(localStorage.getItem('tf-projects-sort')).toBe('oldest')
  })

  it('greets the person by name, without their email', async () => {
    fakeBackend({ projects: [] })
    await openSignedIn(userEvent.setup())
    expect(screen.getByRole('heading', { level: 1, name: 'Hello, Alice' })).toBeInTheDocument()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
  })

  it('shows cards at first and can switch to a list with the same details', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { description: 'Redesign the site' })] })
    const user = userEvent.setup()
    await openSignedIn(user)
    await screen.findByRole('link', { name: /Website/ })
    const cards = screen.getByRole('button', { name: 'Cards' })
    const list = screen.getByRole('button', { name: 'List' })
    expect(screen.getByRole('group', { name: 'Project view' })).toBeInTheDocument()
    expect(cards).toHaveAttribute('aria-pressed', 'true')
    expect(list).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('ul[data-view]')).toHaveAttribute('data-view', 'cards')

    await user.click(list)
    expect(list).toHaveAttribute('aria-pressed', 'true')
    expect(cards).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('ul[data-view]')).toHaveAttribute('data-view', 'list')
    expect(localStorage.getItem('tf-projects-view')).toBe('list')

    const row = screen.getByRole('link', { name: /Website/ })
    expect(row).toHaveAttribute('href', '/projects/p1')
    expect(within(row).getByText('Redesign the site')).toBeInTheDocument()
    expect(within(row).getByText('Owner')).toBeInTheDocument()
    expect(within(row).getByText('No tasks yet')).toBeInTheDocument()
    expect(within(row).getByText('Created 15 Jan 2026')).toBeInTheDocument()
  })

  it('opens in the view chosen last time', async () => {
    localStorage.setItem('tf-projects-view', 'list')
    fakeBackend({ projects: [project('p1', 'Website')] })
    await openSignedIn(userEvent.setup())
    await screen.findByRole('link', { name: /Website/ })
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('ul[data-view]')).toHaveAttribute('data-view', 'list')
  })

  it('has no view switch while there is nothing to view, but the trash stays reachable', async () => {
    fakeBackend()
    await openSignedIn(userEvent.setup())
    await screen.findByText('You have no projects yet.')
    expect(screen.queryByRole('group', { name: 'Project view' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trash' })).toHaveAttribute('href', '/projects/trash')
  })

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

  it('welcomes a new person with three steps and a way to create the first project', async () => {
    fakeBackend()
    const user = userEvent.setup()
    await openSignedIn(user)
    expect(await screen.findByText('You have no projects yet.')).toBeInTheDocument()
    const welcome = screen.getByRole('region', { name: 'Welcome to TaskFlow!' })
    expect(within(welcome).getAllByRole('listitem')).toHaveLength(3)
    await user.click(within(welcome).getByRole('button', { name: 'Create your first project' }))
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeInTheDocument()
  })

  it('shows how far along each project is', async () => {
    fakeBackend({
      projects: [project('p1', 'Half done'), project('p2', 'Empty')],
      tasks: [
        task('t1', 'one', { project: 'p1', status: 'done' }),
        task('t2', 'two', { project: 'p1', status: 'todo' }),
        task('t3', 'gone', { project: 'p1', status: 'done', deletedAt: '2026-02-02T00:00:00Z' }),
      ],
    })
    await openSignedIn(userEvent.setup())
    const half = await screen.findByRole('progressbar', { name: '1 of 2 done' })
    expect(half).toHaveAttribute('aria-valuenow', '1')
    expect(half).toHaveAttribute('aria-valuemax', '2')
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('No tasks yet')).toBeInTheDocument() // the empty project
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
                      taskCount: 0,
                      doneCount: 0,
                      memberCount: 1,
                      members: [],
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
    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    expect(screen.getByRole('heading', { level: 2, name: 'โปรเจกต์ของคุณ' })).toBeInTheDocument()
    expect(screen.getByText(/สร้างเมื่อ .*2569/)).toBeInTheDocument() // Buddhist-era year
    expect(screen.getByText('เจ้าของ')).toBeInTheDocument()
  })
})

describe('sorting the project list', () => {
  const names = () =>
    within(screen.getByRole('list'))
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
  const sample = () => ({
    projects: [project('n', 'Newest'), project('m', 'Middle'), project('o', 'Oldest')],
    tasks: [
      task('a', 'Done', { project: 'o', status: 'done' as const }),
      task('b', 'Not done', { project: 'm' }),
    ],
  })
  const choose = async (user: U, name: string) => {
    await user.click(await screen.findByRole('button', { name: /^Sort projects/ }))
    await user.click(screen.getByRole('menuitemradio', { name }))
  }

  it('shows a picture beside each way of sorting, as well as its words', async () => {
    fakeBackend(sample())
    const user = userEvent.setup()
    await openSignedIn(user)
    await user.click(await screen.findByRole('button', { name: /^Sort projects/ }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items).toHaveLength(6)
    for (const item of items)
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('starts with the newest first, without asking the server for a sort', async () => {
    const api = fakeBackend(sample())
    await openSignedIn(userEvent.setup())
    expect(
      await screen.findByRole('button', { name: 'Sort projects: Newest first' }),
    ).toBeInTheDocument()
    expect(names()).toEqual(['Newest', 'Middle', 'Oldest'])
    expect(api.hits('GET /projects').every((call) => !call.query.has('sort'))).toBe(true)
  })

  it('offers each order and marks the chosen one', async () => {
    fakeBackend(sample())
    const user = userEvent.setup()
    await openSignedIn(user)
    await user.click(await screen.findByRole('button', { name: /^Sort projects/ }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual([
      'Newest first',
      'Oldest first',
      'Recently changed first',
      'Name A–Z',
      'Most progress first',
      'Least progress first',
    ])
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
    expect(items[0]).toHaveFocus()
  })

  it('asks the server, because the list comes in pages, and shows what it answers', async () => {
    const api = fakeBackend(sample())
    const user = userEvent.setup()
    await openSignedIn(user)
    await choose(user, 'Oldest first')
    await waitFor(() => expect(names()).toEqual(['Oldest', 'Middle', 'Newest']))
    expect(api.hits('GET /projects').at(-1)!.query.get('sort')).toBe('oldest')

    await choose(user, 'Most progress first')
    await waitFor(() => expect(names()).toEqual(['Oldest', 'Middle', 'Newest']))
    await choose(user, 'Least progress first')
    await waitFor(() => expect(names()).toEqual(['Middle', 'Oldest', 'Newest'])) // no tasks: last both ways
    expect(
      screen.getByRole('button', { name: 'Sort projects: Least progress first' }),
    ).toHaveFocus()
  })

  it('goes back to the first page, because a new order means a new first page', async () => {
    const api = fakeBackend({ projects: many(30) })
    const user = userEvent.setup()
    await openSignedIn(user, '/?page=2')
    await screen.findByText('Project 13')
    await choose(user, 'Oldest first')
    await screen.findByText('Project 30')
    expect(api.hits('GET /projects').at(-1)!.query.get('page')).toBe('1')
  })

  it('this device remembers the choice', async () => {
    localStorage.setItem('tf-projects-sort', 'oldest')
    const api = fakeBackend(sample())
    await openSignedIn(userEvent.setup())
    expect(
      await screen.findByRole('button', { name: 'Sort projects: Oldest first' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(names()).toEqual(['Oldest', 'Middle', 'Newest']))
    expect(api.hits('GET /projects').at(-1)!.query.get('sort')).toBe('oldest')
  })

  it('is not offered to someone with no projects yet', async () => {
    fakeBackend()
    await openSignedIn(userEvent.setup())
    await screen.findByRole('heading', { name: 'Welcome to TaskFlow' }).catch(() => undefined)
    expect(screen.queryByRole('button', { name: /^Sort projects/ })).not.toBeInTheDocument()
  })

  it('does not change how the trash is listed', async () => {
    localStorage.setItem('tf-projects-sort', 'oldest')
    const api = fakeBackend({
      projects: [project('g', 'Gone', { deletedAt: '2026-01-01T00:00:00Z' })],
    })
    await openSignedIn(userEvent.setup(), '/projects/trash')
    await screen.findByText('Gone')
    expect(api.hits('GET /projects').at(-1)!.query.has('sort')).toBe(false)
  })

  it('works in Thai', async () => {
    fakeBackend(sample())
    const user = userEvent.setup()
    await openSignedIn(user)
    await user.click(await screen.findByRole('button', { name: 'Switch language to ไทย' }))
    expect(
      await screen.findByRole('button', { name: 'เรียงโปรเจกต์: สร้างล่าสุดก่อน' }),
    ).toBeInTheDocument()
  })
})

describe('creating a project', () => {
  async function openDialog(user: U) {
    await screen.findByText('You have no projects yet.')
    await user.click(screen.getByRole('button', { name: /New project|Create your first project/ })!)
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
    const opener = await screen.findByRole('button', { name: 'Create your first project' })
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
    await user.click(screen.getByRole('link', { name: 'My projects' }))
    expect(await screen.findByRole('link', { name: /Brand new/ })).toBeInTheDocument()
  })
})

describe('project page', () => {
  it('shows the details and, for the owner, Edit and Delete', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { description: 'Line one\nLine two' })] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Website' })).toBeInTheDocument()
    expect(screen.getByText(/Line one/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Edit project',
      'Delete project',
    ])
  })

  it('shows a member the project but NO owner actions', async () => {
    fakeBackend({
      projects: [project('p1', 'Team space', { owner: BOB_USER, members: [ME_AS_MEMBER] })],
    })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await screen.findByRole('heading', { level: 1, name: 'Team space' })
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Task trash' })).toBeInTheDocument() // the task trash is for everyone
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    // the member list itself is available, without the owner's tools
    const members = await openMembers(user)
    expect(await within(members).findByText('Bob')).toBeInTheDocument()
    expect(within(members).queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
    expect(within(members).queryByLabelText('Their email')).not.toBeInTheDocument()
    expect(
      within(members).getByText('Only the project owner can invite or remove members.'),
    ).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit project' }))

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
    const api = fakeBackend({
      projects: [project('p1', 'Website')],
      tasks: [task('t1', 'One', { project: 'p1' }), task('t2', 'Two', { project: 'p1' })],
    })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await chooseDelete(user)

    const dialog = await screen.findByRole('dialog', { name: 'Delete project "Website"?' })
    expect(within(dialog).getByText(/can be restored within 30 days/)).toHaveTextContent(
      'Tasks that go with it: 2.',
    )
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus() // the safe choice first
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.hits('DELETE /projects/p1')).toHaveLength(0)
  })

  it('moves the project to the trash, returns to the list, and offers Undo', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website'), project('p2', 'Other')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    await chooseDelete(user)
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
    await chooseDelete(user)
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Move to trash' }),
    )
    expect(await screen.findByText('"Website" moved to the trash.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
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
    await chooseDelete(user)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Move to trash' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('heading', { level: 1, name: 'Website' })).toBeInTheDocument() // still here
  })
})

describe('members', () => {
  it('lists members with roles; the owner row has no Remove button', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { members: [BOB] })] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await openMembers(user)
    expect(await within(section).findByText('Bob')).toBeInTheDocument()
    expect(within(section).getByText(/Joined 1 Feb 2026/)).toBeInTheDocument()
    expect(within(section).getByText('(you)')).toBeInTheDocument()
    expect(within(section).getAllByRole('button', { name: /^Actions for/ })).toHaveLength(1)
    expect(within(section).getByRole('button', { name: 'Actions for Bob' })).toBeInTheDocument()
  })

  it('closes with Escape, the close button or the background, and returns the focus', async () => {
    fakeBackend({ projects: [project('p1', 'Website')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const opener = await screen.findByRole('button', { name: 'Members 1' })

    await user.click(opener)
    const panel = await screen.findByRole('dialog', { name: 'Members' })
    expect(panel).toHaveAttribute('aria-modal', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()

    await user.click(opener)
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(opener)
    await user.click((await screen.findByRole('dialog')).parentElement!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the page inert until every dialog on top of it has closed', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { members: [BOB] })] })
    const user = userEvent.setup()
    const { container } = await openSignedIn(user, '/projects/p1')
    container.id = 'root'
    const section = await openMembers(user)
    await user.click(await within(section).findByRole('button', { name: 'Actions for Bob' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove: Bob' }))
    const confirm = await screen.findByRole('dialog', {
      name: 'Remove Bob from this project?',
    })
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.keyboard('{Escape}') // closes only the confirmation
    expect(screen.getByRole('dialog', { name: 'Members' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions for Bob' })).toHaveFocus()
    expect(container).toHaveAttribute('inert')

    await user.keyboard('{Escape}') // now the panel itself
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container).not.toHaveAttribute('inert')
  })

  it('invites by email, clears the box, and shows the new member', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website')] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await openMembers(user)
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
    const section = await openMembers(user)
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
    const section = await openMembers(user)
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
    const section = await openMembers(user)
    // Invite is the drawer's main button, and it waits for an email that looks right.
    const invite = within(section).getByRole('button', { name: 'Invite' })
    expect(invite).toBeDisabled()
    await user.type(within(section).getByLabelText('Their email'), 'not-an-email')
    expect(invite).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(api.hits('POST /projects/p1/members')).toHaveLength(0)
    await user.type(within(section).getByLabelText('Their email'), '@example.com')
    expect(invite).toBeEnabled()
  })

  it('asks before removing, then removes', async () => {
    const api = fakeBackend({ projects: [project('p1', 'Website', { members: [BOB, CAROL] })] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await openMembers(user)
    await user.click(await within(section).findByRole('button', { name: 'Actions for Bob' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove: Bob' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Remove Bob from this project?',
    })
    expect(
      within(dialog).getByText(/Bob \(bob@example\.com\) will lose access/),
    ).toBeInTheDocument()
    // Removing someone does not use the trash, so the dialog must not promise it can be restored.
    expect(dialog).not.toHaveTextContent(/trash|restore/i)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.hits('DELETE /projects/p1/members/' + BOB.userId)).toHaveLength(0)

    await user.click(within(section).getByRole('button', { name: 'Actions for Bob' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove: Bob' }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Remove Bob from this project?' }),
      ).getByRole('button', { name: 'Remove' }),
    )
    await waitFor(() => expect(within(section).queryByText('Bob')).not.toBeInTheDocument())
    expect(within(section).getByText('Carol')).toBeInTheDocument()
    expect(await screen.findByText('Bob was removed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('keeps the keyboard inside the panel after removing someone, so Escape still closes it', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { members: [BOB, CAROL] })] })
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    const section = await openMembers(user)
    await user.click(await within(section).findByRole('button', { name: 'Actions for Bob' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove: Bob' }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Remove Bob from this project?' }),
      ).getByRole('button', { name: 'Remove' }),
    )
    await screen.findByText('Bob was removed.')

    await waitFor(() => expect(within(section).getByLabelText('Their email')).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Members' })).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await screen.findByRole('heading', { level: 1, name: 'Log in' })

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(screen.queryByText('Alice private plan')).not.toBeInTheDocument()
  })

  it("does not show the previous person's projects to the next person, even for a moment", async () => {
    fakeBackend({ projects: [project('p1', 'Alice private plan')] })
    const user = userEvent.setup()
    await openSignedIn(user)
    await screen.findByRole('link', { name: /Alice private plan/ })
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
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
    await screen.findByRole('heading', { name: 'Hello, Bob' })
    expect(screen.queryByText('Alice private plan')).not.toBeInTheDocument()
    release()
  })
})

describe('who is in each project, and whose projects show', () => {
  const headings = () =>
    within(screen.getByRole('list'))
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)

  it('names the people on each card, the owner first', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { members: [BOB] })] })
    await openSignedIn(userEvent.setup())
    expect(await screen.findByTitle('Members: Alice, Bob')).toBeInTheDocument()
  })

  it('names the first five of a big team and counts the rest', async () => {
    const team = Array.from({ length: 6 }, (_, i) => ({
      userId: `4444444${i}-4444-4444-4444-444444444444`,
      email: `p${i}@example.com`,
      displayName: `P${i}`,
    }))
    fakeBackend({ projects: [project('p1', 'Website', { members: team })] })
    await openSignedIn(userEvent.setup())
    expect(await screen.findByTitle('Members: Alice, P0, P1, P2, P3 +2 more')).toBeInTheDocument()
  })

  it('shows the projects of the people ticked, and keeps them in the address', async () => {
    const api = fakeBackend({
      projects: [
        project('p1', 'Website', { members: [BOB, CAROL] }),
        project('p2', 'Shop'),
        project('p3', 'Blog', { members: [CAROL] }),
      ],
      tasks: [
        task('t1', 'Fix', { project: 'p1', assigneeIds: [BOB.userId] }),
        task('t2', 'Sell', { project: 'p2', assigneeIds: [ME.id] }),
        task('t3', 'Write', { project: 'p3', assigneeIds: [CAROL.userId] }),
      ],
    })
    const user = userEvent.setup()
    await openSignedIn(user)
    await screen.findByRole('link', { name: /Website/ })
    await user.click(screen.getByRole('button', { name: 'Show: All projects' }))
    const bob = await screen.findByRole('menuitemcheckbox', {
      name: 'Show projects: Where Bob has tasks · bob@example.com',
    })
    expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual([
      'All projects',
      'AWhere I have tasks',
      'BBob',
      'CCarol',
    ])
    await user.click(bob)
    await waitFor(() => expect(headings()).toEqual(['Website']))
    expect(api.hits('GET /projects').at(-1)!.query.get('person')).toBe(BOB.userId)

    // The menu stays open for the next one: any of them with a task counts.
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Show projects: Where I have tasks' }),
    )
    await waitFor(() => expect(headings()).toEqual(['Website', 'Shop']))
    expect(api.hits('GET /projects').at(-1)!.query.get('person')).toBe(`${BOB.userId},${ME.id}`)
    expect(screen.getByRole('button', { name: 'Show: Where I have tasks +1' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Where Bob has tasks/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // Taking one off, and a new order, keep the rest.
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Where Bob has tasks/ }))
    await waitFor(() => expect(headings()).toEqual(['Shop']))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /^Sort projects/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Name A–Z' }))
    await waitFor(() => expect(api.hits('GET /projects').at(-1)!.query.get('sort')).toBe('name'))
    expect(api.hits('GET /projects').at(-1)!.query.get('person')).toBe(ME.id)

    // "All projects" takes every tick off.
    await user.click(screen.getByRole('button', { name: 'Show: Where I have tasks' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Show projects: All projects' }))
    await waitFor(() => expect(headings()).toEqual(['Blog', 'Shop', 'Website']))
  })

  it('reads several people from the address, and leaves out what is not a person', async () => {
    const api = fakeBackend({
      projects: [project('p1', 'Website', { members: [BOB, CAROL] })],
      tasks: [task('t1', 'Fix', { project: 'p1', assigneeIds: [CAROL.userId] })],
    })
    await openSignedIn(
      userEvent.setup(),
      `/?person=${BOB.userId},nobody,${CAROL.userId},${BOB.userId}`,
    )
    expect(await screen.findByRole('link', { name: /Website/ })).toBeInTheDocument()
    expect(api.hits('GET /projects').at(-1)!.query.get('person')).toBe(
      `${BOB.userId},${CAROL.userId}`,
    )
    expect(
      await screen.findByRole('button', { name: 'Show: Where Bob has tasks +1' }),
    ).toBeInTheDocument()
  })

  it('says when nobody chosen has a project, and offers them all again', async () => {
    fakeBackend({ projects: [project('p1', 'Website', { members: [BOB] })] })
    const user = userEvent.setup()
    await openSignedIn(user, `/?person=${BOB.userId}`)
    expect(await screen.findByText('No projects match this choice.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Welcome to TaskFlow' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all projects' }))
    expect(await screen.findByRole('link', { name: /Website/ })).toBeInTheDocument()
  })
})
