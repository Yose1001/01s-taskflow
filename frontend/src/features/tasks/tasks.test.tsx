import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../../App'
import type { Task } from '../../api/types'
import { BOB, CAROL, fakeBackend, project, task } from '../../test/fakeBackend'
import { ME } from '../../test/mockApi'
import { renderApp } from '../../test/render'

const BOB_USER = { ...ME, id: BOB.userId, email: BOB.email, displayName: BOB.displayName }
const ME_AS_MEMBER = { userId: ME.id, email: ME.email, displayName: ME.displayName }

type U = ReturnType<typeof userEvent.setup>

/** Opens the app at `route`, signs in as Alice, and waits for the first page to settle. */
async function openSignedIn(user: U, route: string) {
  const view = renderApp(<AppRoutes />, { route })
  await user.type(screen.getByLabelText('Email'), 'alice@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  return view
}

const WEBSITE = () => project('p1', 'Website', { members: [BOB] })

const sample = (): Task[] => [
  task('t1', 'Draw logo', { position: 1024, priority: 'high', assigneeId: BOB.userId }),
  task('t2', 'Write copy', { position: 2048, priority: 'low' }),
  task('t3', 'Pick colors', { position: 3072, priority: 'medium', assigneeId: ME.id }),
  task('t4', 'Build header', { status: 'in_progress', position: 1024, priority: 'high' }),
  task('t5', 'Ship it', { status: 'done', position: 1024, dueDate: '2020-01-01' }),
]

async function openBoard(
  user: U,
  tasks: Task[] = sample(),
  extra: Parameters<typeof fakeBackend>[0] = {},
) {
  const api = fakeBackend({ projects: [WEBSITE()], tasks, ...extra })
  await openSignedIn(user, '/projects/p1')
  await screen.findByRole('region', { name: /^To do,/ })
  return api
}

const column = (name: RegExp | string) => screen.getByRole('region', { name })
const titlesIn = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('button:not([aria-label])')?.textContent)
    .filter(Boolean)

describe('board', () => {
  it('shows four columns with counts, and the cards in board order', async () => {
    await openBoard(userEvent.setup())
    expect(titlesIn(column('To do, 3 tasks'))).toEqual(['Draw logo', 'Write copy', 'Pick colors'])
    expect(titlesIn(column('In progress, 1 tasks'))).toEqual(['Build header'])
    expect(column('In review, 0 tasks')).toBeInTheDocument()
    expect(titlesIn(column('Done, 1 tasks'))).toEqual(['Ship it'])
    expect(within(column(/^In review/)).getByText('Nothing here yet')).toBeInTheDocument()
  })

  it('shows priority, assignee and due date on a card (text, not only color)', async () => {
    await openBoard(userEvent.setup())
    const todo = column(/^To do/)
    expect(within(todo).getAllByText('High').length).toBeGreaterThan(0)
    expect(within(todo).getByText('Assigned to Bob')).toBeInTheDocument()
    expect(within(todo).getByText('Assigned to Alice')).toBeInTheDocument()
    expect(within(column(/^Done/)).getByText('Due 1 Jan 2020')).toBeInTheDocument()
  })

  it('flags an overdue task with a word, but not a finished one', async () => {
    await openBoard(userEvent.setup(), [
      task('a', 'Late', { dueDate: '2020-01-01' }),
      task('b', 'Fine', { dueDate: '2099-01-01' }),
      task('c', 'Late but done', { status: 'done', dueDate: '2020-01-01' }),
    ])
    expect(within(column(/^To do/)).getByText(/Overdue · Due 1 Jan 2020/)).toBeInTheDocument()
    expect(within(column(/^To do/)).getByText('Due 1 Jan 2099')).toBeInTheDocument()
    expect(within(column(/^Done/)).queryByText(/Overdue/)).not.toBeInTheDocument()
  })

  it('shows a friendly message when there are no tasks yet', async () => {
    await openBoard(userEvent.setup(), [])
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument()
  })

  it('shows titles as plain text, never as HTML', async () => {
    await openBoard(userEvent.setup(), [task('x', '<img src=x onerror=alert(1)> <b>bold</b>')])
    expect(screen.getByText('<img src=x onerror=alert(1)> <b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
  })

  it('reads every page when a project has more than 100 tasks', async () => {
    const lots = Array.from({ length: 150 }, (_, i) =>
      task(`n${i}`, `Task ${i}`, { position: i + 1 }),
    )
    const api = await openBoard(userEvent.setup(), lots)
    await screen.findByRole('region', { name: 'To do, 150 tasks' })
    expect(api.hits('GET /projects/p1/tasks').map((c) => c.query.get('page'))).toEqual(['1', '2'])
  })

  it('shows an error with Try again that recovers', async () => {
    let fail = true
    const api = fakeBackend({
      projects: [WEBSITE()],
      tasks: sample(),
    })
    const original = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation(async (input, init) =>
      fail && String(input).includes('/tasks')
        ? new Response(JSON.stringify({ code: 'internal_error', message: 'x' }), { status: 500 })
        : original(input, init),
    )
    const user = userEvent.setup()
    await openSignedIn(user, '/projects/p1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: /^To do/ })).toBeInTheDocument()
  })

  it('works in Thai too', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'ไทย' }))
    expect(screen.getByRole('region', { name: 'รอทำ 3 งาน' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'สร้างงานใหม่' })).toBeInTheDocument()
    expect(screen.getByText(/ครบกำหนด 1 ม\.ค\. 2563/)).toBeInTheDocument() // Buddhist-era year
  })

  it('says "not found" for a project the person cannot see (tasks included)', async () => {
    fakeBackend({ projects: [], tasks: sample() })
    await openSignedIn(userEvent.setup(), '/projects/p1')
    expect(await screen.findByText('Project not found')).toBeInTheDocument()
    expect(screen.queryByText('Draw logo')).not.toBeInTheDocument()
  })
})

describe('filters', () => {
  it('search narrows the cards (any case) and can be cleared', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.type(screen.getByLabelText('Search tasks'), 'LOGO')
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])
    expect(titlesIn(column(/^In progress/))).toEqual([])
    expect(screen.getByText('Showing 1 of 5 tasks')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(titlesIn(column(/^To do/))).toHaveLength(3)
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search tasks')).toHaveValue('')
  })

  it('filters by priority and by person (including "Unassigned")', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.selectOptions(screen.getByLabelText('Priority'), 'High')
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])
    expect(titlesIn(column(/^In progress/))).toEqual(['Build header'])

    await user.selectOptions(screen.getByLabelText('Priority'), 'All')
    await user.selectOptions(screen.getByLabelText('Assigned to'), 'Bob')
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])

    await user.selectOptions(screen.getByLabelText('Assigned to'), 'Unassigned')
    expect(titlesIn(column(/^To do/))).toEqual(['Write copy'])
    expect(titlesIn(column(/^In progress/))).toEqual(['Build header'])
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.type(screen.getByLabelText('Search tasks'), 'zzzz')
    expect(screen.getByText('No tasks match the filters.')).toBeInTheDocument()
  })

  it('keeps the filters in the address, so a reload restores them', async () => {
    const user = userEvent.setup()
    fakeBackend({ projects: [WEBSITE()], tasks: sample() })
    await openSignedIn(user, '/projects/p1?q=copy&priority=low')
    await screen.findByRole('region', { name: /^To do/ })
    expect(screen.getByLabelText('Search tasks')).toHaveValue('copy')
    expect(screen.getByLabelText('Priority')).toHaveValue('low')
    expect(titlesIn(column(/^To do/))).toEqual(['Write copy'])
  })

  it('ignores nonsense in the address instead of trusting it', async () => {
    const user = userEvent.setup()
    fakeBackend({ projects: [WEBSITE()], tasks: sample() })
    await openSignedIn(user, '/projects/p1?priority=urgent&assignee=someone-else')
    await screen.findByRole('region', { name: /^To do/ })
    expect(screen.getByLabelText('Priority')).toHaveValue('')
    expect(screen.getByLabelText('Assigned to')).toHaveValue('')
    expect(titlesIn(column(/^To do/))).toHaveLength(3)
  })

  it('filtering does not call the server again (everything is already loaded)', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user)
    const before = api.hits('GET /projects/p1/tasks').length
    await user.type(screen.getByLabelText('Search tasks'), 'logo')
    await user.selectOptions(screen.getByLabelText('Priority'), 'High')
    expect(api.hits('GET /projects/p1/tasks')).toHaveLength(before)
  })
})

describe('creating a task', () => {
  it('opens an accessible dialog with the focus on the title', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByLabelText('Title')).toHaveFocus()
    expect(within(dialog).getByLabelText('Column')).toHaveValue('todo')
  })

  it('the + of a column starts the task in that column', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'Add a task to In review' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Column')).toHaveValue('review')
  })

  it('checks the title before calling the server', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    expect(await within(dialog).findByText('This field is required.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Title')).toHaveFocus()

    await user.type(within(dialog).getByLabelText('Title'), 'x'.repeat(201))
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    expect(
      await within(dialog).findByText('Enter a title of 1 to 200 characters.'),
    ).toBeInTheDocument()
    expect(api.hits('POST /projects/p1/tasks')).toHaveLength(0)
  })

  it('creates the task with the chosen values, trims the title, and puts it last in its column', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), '  Test the app  ')
    await user.type(within(dialog).getByLabelText('Description (optional)'), 'All of it')
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'High')
    await user.selectOptions(within(dialog).getByLabelText('Assigned to'), 'Bob')
    fireEvent.change(within(dialog).getByLabelText('Due date (optional)'), {
      target: { value: '2099-03-04' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('POST /projects/p1/tasks')[0]!.body).toEqual({
      title: 'Test the app',
      description: 'All of it',
      priority: 'high',
      status: 'todo',
      assigneeId: BOB.userId,
      dueDate: '2099-03-04',
    })
    expect(await screen.findByText('Task created.')).toBeInTheDocument()
    await waitFor(() =>
      expect(titlesIn(column(/^To do/))).toEqual([
        'Draw logo',
        'Write copy',
        'Pick colors',
        'Test the app',
      ]),
    )
  })

  it('leaves out assignee and due date when they are not set', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Plain')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(api.hits('POST /projects/p1/tasks')).toHaveLength(1))
    const body = api.hits('POST /projects/p1/tasks')[0]!.body as Record<string, unknown>
    expect(body).not.toHaveProperty('assigneeId')
    expect(body).not.toHaveProperty('dueDate')
  })

  it('shows a server field error next to the field and keeps the dialog open', async () => {
    const user = userEvent.setup()
    await openBoard(user, sample(), {
      routes: {
        'POST /projects/:id/tasks': () => ({
          status: 422,
          body: { code: 'validation_failed', message: 'x', fields: { dueDate: 'invalid_date' } },
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Anything')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    expect(await within(dialog).findByText('Enter a valid date.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Due date (optional)')).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('says the description limit for tasks (5000), not the one for projects (2000)', async () => {
    const user = userEvent.setup()
    await openBoard(user, sample(), {
      routes: {
        'POST /projects/:id/tasks': () => ({
          status: 422,
          body: {
            code: 'validation_failed',
            message: 'x',
            fields: { description: 'description_too_long' },
          },
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Anything')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    expect(await within(dialog).findByText(/5000 characters at most/)).toBeInTheDocument()
  })

  it('shows a banner for other failures, and the button recovers', async () => {
    const user = userEvent.setup()
    await openBoard(user, sample(), {
      routes: {
        'POST /projects/:id/tasks': () => ({
          status: 500,
          body: { code: 'internal_error', message: 'x' },
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Anything')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeEnabled()
  })

  it('closes with Escape and gives the focus back to the button', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    const opener = screen.getByRole('button', { name: 'New task' })
    await user.click(opener)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})

describe('editing a task', () => {
  async function openEdit(user: U, title: string, tasks: Task[] = sample(), extra = {}) {
    const api = await openBoard(user, tasks, extra)
    await user.click(screen.getByRole('button', { name: title }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
    return { api, dialog }
  }

  it('opens with the current values filled in', async () => {
    const user = userEvent.setup()
    const { dialog } = await openEdit(user, 'Draw logo')
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Draw logo')
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('high')
    expect(within(dialog).getByLabelText('Assigned to')).toHaveValue(BOB.userId)
    expect(within(dialog).getByLabelText('Column')).toHaveValue('todo')
  })

  it('sends only the fields that changed', async () => {
    const user = userEvent.setup()
    const { api, dialog } = await openEdit(user, 'Draw logo')
    const field = within(dialog).getByLabelText('Title')
    await user.clear(field)
    await user.type(field, 'Draw the new logo')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('PATCH /tasks/t1')[0]!.body).toEqual({ title: 'Draw the new logo' })
    expect(api.hits('POST /tasks/t1/move')).toHaveLength(0)
    expect(await screen.findByText('Task saved.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Draw the new logo' })).toBeInTheDocument()
  })

  it('does not call the server when nothing was changed', async () => {
    const user = userEvent.setup()
    const { api, dialog } = await openEdit(user, 'Draw logo')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('PATCH /tasks/t1')).toHaveLength(0)
    expect(api.hits('POST /tasks/t1/move')).toHaveLength(0)
    expect(screen.queryByText('Task saved.')).not.toBeInTheDocument() // nothing was saved, so nothing is claimed
  })

  it('clearing the assignee and the date sends null for both', async () => {
    const user = userEvent.setup()
    const tasks = [task('t1', 'Has both', { assigneeId: BOB.userId, dueDate: '2099-01-01' })]
    const { api, dialog } = await openEdit(user, 'Has both', tasks)
    await user.selectOptions(within(dialog).getByLabelText('Assigned to'), 'Unassigned')
    fireEvent.change(within(dialog).getByLabelText('Due date (optional)'), {
      target: { value: '' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.hits('PATCH /tasks/t1')).toHaveLength(1))
    expect(api.hits('PATCH /tasks/t1')[0]!.body).toEqual({ assigneeId: null, dueDate: null })
  })

  it('changing the column moves the task to the end of that column (no PATCH needed)', async () => {
    const user = userEvent.setup()
    const { api, dialog } = await openEdit(user, 'Write copy')
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'Done')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('PATCH /tasks/t2')).toHaveLength(0)
    expect(api.hits('POST /tasks/t2/move')[0]!.body).toEqual({ status: 'done', beforeTaskId: null })
    await waitFor(() => expect(titlesIn(column(/^Done/))).toEqual(['Ship it', 'Write copy']))
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Pick colors'])
  })

  it('saves the fields first, then moves, when both changed', async () => {
    const user = userEvent.setup()
    const { api, dialog } = await openEdit(user, 'Write copy')
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'High')
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'In review')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.hits('POST /tasks/t2/move')).toHaveLength(1))
    expect(api.hits('PATCH /tasks/t2')[0]!.body).toEqual({ priority: 'high' })
    const order = api.calls.map((c) => `${c.method} ${c.pathname}`)
    expect(order.indexOf('PATCH /tasks/t2')).toBeLessThan(order.indexOf('POST /tasks/t2/move'))
  })

  it('does not move the task when saving the fields failed', async () => {
    const user = userEvent.setup()
    const { api, dialog } = await openEdit(user, 'Write copy', sample(), {
      routes: {
        'PATCH /tasks/:id': () => ({ status: 500, body: { code: 'internal_error', message: 'x' } }),
      },
    })
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'High')
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'Done')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(api.hits('POST /tasks/t2/move')).toHaveLength(0)
  })

  it('a project member who is not the owner can edit tasks too', async () => {
    const user = userEvent.setup()
    fakeBackend({
      projects: [project('p1', 'Shared', { owner: BOB_USER, members: [ME_AS_MEMBER] })],
      tasks: sample(),
    })
    await openSignedIn(user, '/projects/p1')
    await user.click(await screen.findByRole('button', { name: 'Draw logo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })
})

describe('deleting and restoring', () => {
  async function askToDelete(user: U, title = 'Write copy') {
    const api = await openBoard(user)
    await user.click(screen.getByRole('button', { name: title }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )
    const confirm = await screen.findByRole('dialog', { name: 'Delete this task?' })
    return { api, confirm }
  }

  it('asks first; Cancel has the focus and changes nothing', async () => {
    const user = userEvent.setup()
    const { api, confirm } = await askToDelete(user)
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(api.hits('DELETE /tasks/t2')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Write copy' })).toBeInTheDocument()
  })

  it('moves the task to the trash and offers Undo, which brings it back in place', async () => {
    const user = userEvent.setup()
    const { api, confirm } = await askToDelete(user)
    await user.click(within(confirm).getByRole('button', { name: 'Move to trash' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Write copy' })).not.toBeInTheDocument(),
    )
    expect(api.hits('DELETE /tasks/t2')).toHaveLength(1)
    // (the drag-and-drop library has its own hidden role="status" area, so find the toast by its text)
    const toast = (await screen.findByText('"Write copy" moved to the trash.')).closest('div')!

    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('"Write copy" restored.')).toBeInTheDocument()
    await waitFor(() =>
      expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Write copy', 'Pick colors']),
    )
  })

  it('shows an error in the confirm dialog if the delete fails, and the task stays', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, sample(), {
      routes: {
        'DELETE /tasks/:id': () => ({
          status: 500,
          body: { code: 'internal_error', message: 'x' },
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Write copy' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )
    const confirm = await screen.findByRole('dialog', { name: 'Delete this task?' })
    await user.click(within(confirm).getByRole('button', { name: 'Move to trash' }))
    expect(await within(confirm).findByRole('alert')).toBeInTheDocument()
    expect(api.hits('DELETE /tasks/t2')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Write copy' })).toBeInTheDocument()
  })
})

describe('task trash page', () => {
  const trashed = (): Task[] => [
    ...sample(),
    task('d1', 'Old idea', {
      status: 'review',
      deletedAt: new Date().toISOString(),
    }),
  ]

  it('lists deleted tasks with the days left, and keeps them off the board', async () => {
    const user = userEvent.setup()
    fakeBackend({ projects: [WEBSITE()], tasks: trashed() })
    await openSignedIn(user, '/projects/p1')
    await screen.findByRole('region', { name: /^To do/ })
    expect(screen.queryByText('Old idea')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Trash' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Task trash' })).toBeInTheDocument()
    expect(await screen.findByText('Old idea')).toBeInTheDocument()
    expect(screen.getByText(/Days left: 30/)).toBeInTheDocument()
    expect(screen.getByText('In review')).toBeInTheDocument()
  })

  it('restores a task, and it is back on the board', async () => {
    const user = userEvent.setup()
    const api = fakeBackend({ projects: [WEBSITE()], tasks: trashed() })
    await openSignedIn(user, '/projects/p1/trash')
    await user.click(await screen.findByRole('button', { name: 'Restore: Old idea' }))
    expect(await screen.findByText('"Old idea" restored.')).toBeInTheDocument()
    expect(api.hits('POST /tasks/d1/restore')).toHaveLength(1)
    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Back to the board/ }))
    expect(
      await within(await screen.findByRole('region', { name: /^In review/ })).findByText(
        'Old idea',
      ),
    ).toBeInTheDocument()
  })

  it('has an empty state', async () => {
    fakeBackend({ projects: [WEBSITE()], tasks: sample() })
    await openSignedIn(userEvent.setup(), '/projects/p1/trash')
    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument()
  })

  it('says "not found" to someone who is not in the project', async () => {
    fakeBackend({ projects: [], tasks: trashed() })
    await openSignedIn(userEvent.setup(), '/projects/p1/trash')
    expect(await screen.findByText('Project not found')).toBeInTheDocument()
    expect(screen.queryByText('Old idea')).not.toBeInTheDocument()
  })
})

describe('members and tasks', () => {
  it('removing a member un-assigns their tasks on the board', async () => {
    const user = userEvent.setup()
    await openBoard(user, [task('t1', 'Bobs job', { assigneeId: BOB.userId })], {
      projects: [project('p1', 'Website', { members: [BOB, CAROL] })],
    })
    expect(screen.getByText('Assigned to Bob')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Assigned to'), 'Unassigned')
    expect(screen.queryByRole('button', { name: 'Bobs job' })).not.toBeInTheDocument()
    const members = screen.getByRole('region', { name: 'Members' })
    const row = (await within(members).findByText('Bob')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /^Remove/ }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove member' }),
    )
    // The task itself changed on the server (no assignee any more), so the board must reload it.
    expect(await screen.findByRole('button', { name: 'Bobs job' })).toBeInTheDocument()
  })
})
