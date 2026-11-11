import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../../App'
import type { Task } from '../../api/types'
import { BOB, CAROL, fakeBackend, project, task } from '../../test/fakeBackend'
import { ME } from '../../test/mockApi'
import { renderApp } from '../../test/render'

const BOB_USER = { ...ME, id: BOB.userId, email: BOB.email, displayName: BOB.displayName }
const ME_AS_MEMBER = { userId: ME.id, email: ME.email, displayName: ME.displayName }

type U = ReturnType<typeof userEvent.setup>

const NEXT_YEAR = new Date().getFullYear() + 1

/** Chooses a day in the calendar of the date field with this label. */
async function pickDay(user: U, label: string, day: string) {
  await user.click(screen.getByLabelText(label))
  const calendar = await screen.findByRole('dialog', { name: label })
  await user.selectOptions(within(calendar).getByLabelText('Year'), day.slice(0, 4))
  await user.selectOptions(
    within(calendar).getByLabelText('Month'),
    String(Number(day.slice(5, 7)) - 1),
  )
  await user.click(calendar.querySelector(`[data-day="${day}"]`)!)
}

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
  task('t1', 'Draw logo', { position: 1024, priority: 'high', assigneeIds: [BOB.userId] }),
  task('t2', 'Write copy', { position: 2048, priority: 'low' }),
  task('t3', 'Pick colors', { position: 3072, priority: 'medium', assigneeIds: [ME.id] }),
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

/** Ticks or unticks people in the "Assigned to" menu, then closes it. */
async function toggleAssignees(user: U, names: string[]) {
  await user.click(screen.getByRole('button', { name: /^Assigned to:/ }))
  for (const name of names) await user.click(screen.getByRole('menuitemcheckbox', { name }))
  await user.keyboard('{Escape}')
}
const titlesIn = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('button:not([aria-label])')?.textContent)
    .filter(Boolean)

describe('board', () => {
  it('shows five columns with counts, and the cards in board order', async () => {
    await openBoard(userEvent.setup())
    expect(titlesIn(column('To do, 3 tasks'))).toEqual(['Draw logo', 'Write copy', 'Pick colors'])
    expect(titlesIn(column('In progress, 1 tasks'))).toEqual(['Build header'])
    expect(column('In review, 0 tasks')).toBeInTheDocument()
    expect(column('On hold, 0 tasks')).toBeInTheDocument()
    expect(titlesIn(column('Done, 1 tasks'))).toEqual(['Ship it'])
    expect(within(column(/^In review/)).getByText('Nothing here yet')).toBeInTheDocument()
  })

  it('shows priority, assignee and due date on a card (text, not only color)', async () => {
    await openBoard(userEvent.setup())
    const todo = column(/^To do/)
    expect(within(todo).getAllByText('High').length).toBeGreaterThan(0)
    expect(within(todo).getByTitle('Assigned to Bob')).toBeInTheDocument()
    expect(within(todo).getByTitle('Assigned to Alice')).toBeInTheDocument()
    expect(within(column(/^Done/)).getByText('1 Jan 2020')).toBeInTheDocument()
  })

  it('flags an overdue task with a word, but not a finished one', async () => {
    await openBoard(userEvent.setup(), [
      task('a', 'Late', { dueDate: '2020-01-01' }),
      task('b', 'Fine', { dueDate: '2099-01-01' }),
      task('c', 'Late but done', { status: 'done', dueDate: '2020-01-01' }),
    ])
    expect(within(column(/^To do/)).getByText('Overdue').parentElement).toHaveTextContent(
      '1 Jan 2020',
    )
    expect(within(column(/^To do/)).getByText('1 Jan 2099')).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    expect(screen.getByRole('region', { name: 'รอทำ 3 งาน' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'สร้างงาน' })).toBeInTheDocument()
    expect(screen.getByText('1 ม.ค. 2563')).toBeInTheDocument() // Buddhist-era year
  })

  it('marks the due date for machines and shows the full date on hover', async () => {
    await openBoard(userEvent.setup(), [task('a', 'Dated', { dueDate: '2099-03-04' })])
    const date = screen.getByText('4 Mar 2099')
    expect(date.tagName).toBe('TIME')
    expect(date).toHaveAttribute('datetime', '2099-03-04')
    expect(date).toHaveAttribute('title', 'Ends 4 Mar 2099')
  })

  it('says so when nobody is assigned, and keeps the full title available on a long one', async () => {
    await openBoard(userEvent.setup(), [task('a', 'A very long title')])
    expect(within(column(/^To do/)).getByRole('img', { name: 'Unassigned' })).toBeInTheDocument()
    expect(within(column(/^To do/)).getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A very long title' })).toHaveAttribute(
      'title',
      'A very long title',
    )
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

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(titlesIn(column(/^To do/))).toHaveLength(3)
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search tasks')).toHaveValue('')
  })

  it('shows each active filter as a chip that removes only itself', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    expect(screen.queryByText('Filtering by:')).not.toBeInTheDocument() // nothing to show at first

    await user.type(screen.getByLabelText('Search tasks'), 'logo')
    await user.selectOptions(screen.getByLabelText('Priority'), 'High')
    expect(screen.getByText('Filtering by:')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove filter: High' }))
    expect(screen.getByLabelText('Priority')).toHaveValue('')
    expect(screen.getByLabelText('Search tasks')).toHaveValue('logo')
    expect(screen.queryByRole('button', { name: 'Remove filter: High' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove filter: logo' }))
    expect(screen.queryByText('Filtering by:')).not.toBeInTheDocument()
  })

  it('on a phone, the sheet changes nothing until "Show N tasks"', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    const opener = screen.getByRole('button', { name: 'Filters' })
    await user.click(opener)
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })

    await user.selectOptions(within(sheet).getByLabelText('Priority'), 'High')
    const show = within(sheet).getByRole('button', { name: /^Show \d+ tasks$/ })
    expect(document.getElementById('filter-priority')).toHaveValue('')
    expect(titlesIn(column(/^To do/))).toHaveLength(3) // the board has not changed yet

    const number = Number(/\d+/.exec(show.textContent!)![0])
    await user.click(show)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.getElementById('filter-priority')).toHaveValue('high')
    expect(screen.getByText(new RegExp(`^Showing ${number} of`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toHaveFocus()
  })

  it('in the sheet, several people can be ticked', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    const people = within(sheet).getByRole('group', { name: 'Assigned to' })
    await user.click(within(people).getByRole('checkbox', { name: 'Bob' }))
    await user.click(within(people).getByRole('checkbox', { name: 'Unassigned' }))
    await user.click(within(sheet).getByRole('button', { name: /^Show \d+ tasks$/ }))
    expect(screen.getByRole('button', { name: 'Filters (2)' })).toHaveFocus()
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Write copy'])
  })

  it('in the sheet, Clear all empties the choices; closing without Show keeps the board', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.selectOptions(screen.getByLabelText('Priority'), 'High')

    await user.click(screen.getByRole('button', { name: 'Filters (1)' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    expect(within(sheet).getByLabelText('Priority')).toHaveValue('high')
    await user.click(within(sheet).getByRole('button', { name: 'Clear all' }))
    expect(within(sheet).getByLabelText('Priority')).toHaveValue('')

    await user.keyboard('{Escape}')
    expect(document.getElementById('filter-priority')).toHaveValue('high')
  })

  it('on a phone, New task starts in the column that is in view', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    // The test browser has no layout: put the columns side by side, 320px apart, and swipe to the third.
    const board = column(/^To do/).parentElement!
    ;[...board.children].forEach((col, index) =>
      Object.defineProperty(col, 'offsetLeft', { configurable: true, value: 16 + 320 * index }),
    )
    board.scrollLeft = 640
    fireEvent.scroll(board)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByLabelText('Column')).toHaveValue('review')
  })

  it('offers New task in the project header, opening on the first column', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByLabelText('Column')).toHaveValue('todo')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toHaveFocus()
  })

  it('filters by priority and by person (including "Unassigned")', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.selectOptions(screen.getByLabelText('Priority'), 'High')
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])
    expect(titlesIn(column(/^In progress/))).toEqual(['Build header'])

    await user.selectOptions(screen.getByLabelText('Priority'), 'All')
    await toggleAssignees(user, ['Bob'])
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])
    expect(screen.getByRole('button', { name: 'Assigned to: Bob' })).toBeInTheDocument()

    await toggleAssignees(user, ['Bob', 'Unassigned']) // Bob off, Unassigned on
    expect(titlesIn(column(/^To do/))).toEqual(['Write copy'])
    expect(titlesIn(column(/^In progress/))).toEqual(['Build header'])
  })

  it('shows the tasks of every person ticked, and keeps them in the address', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'Assigned to: All' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Bob' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Unassigned' }))
    // The menu stays open for the next tick.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Unassigned' })).toHaveFocus()
    expect(screen.getByRole('menuitemcheckbox', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await user.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: 'Assigned to: Unassigned +1' })).toHaveFocus()
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Write copy'])
    expect(titlesIn(column(/^In progress/))).toEqual(['Build header'])
    expect(screen.getByRole('button', { name: 'Remove filter: Bob' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove filter: Unassigned' }))
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])

    await user.click(screen.getByRole('button', { name: 'Assigned to: Bob' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'All' }))
    await user.keyboard('{Escape}')
    expect(titlesIn(column(/^To do/))).toHaveLength(3)
  })

  it('reads several people from the address', async () => {
    const user = userEvent.setup()
    fakeBackend({ projects: [WEBSITE()], tasks: sample() })
    await openSignedIn(user, `/projects/p1?assignee=${BOB.userId},none,someone-else`)
    await screen.findByRole('region', { name: /^To do/ })
    expect(
      await screen.findByRole('button', { name: 'Assigned to: Unassigned +1' }),
    ).toBeInTheDocument()
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Write copy'])
  })

  it('two quick changes in a row both count (the second does not undo the first)', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    // Both happen before the screen has redrawn, like a very fast double change.
    act(() => {
      fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } })
      fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'logo' } })
    })
    await waitFor(() => expect(screen.getByLabelText('Priority')).toHaveValue('high'))
    expect(screen.getByLabelText('Search tasks')).toHaveValue('logo')
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])
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
    expect(screen.getByRole('button', { name: 'Assigned to: All' })).toBeInTheDocument()
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

  it('each column offers a sort menu, and a sort changes only that column', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Write copy', 'Pick colors'])
    expect(screen.getAllByRole('button', { name: /^Sort / })).toHaveLength(5)

    const button = screen.getByRole('button', { name: 'Sort To do: My order' })
    await user.click(button)
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'My order',
      'Highest priority first',
      'Ending soonest',
      'Newest first',
    ])
    expect(screen.getByRole('menuitemradio', { name: 'My order' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(screen.getByRole('menuitemradio', { name: 'Highest priority first' }))
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Pick colors', 'Write copy'])
    expect(screen.getByRole('button', { name: 'Sort To do: Highest priority first' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Sort In review: My order' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sort To do: Highest priority first' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'My order' }))
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Write copy', 'Pick colors'])
  })

  it('opens the sort menu on the chosen item, and remembers the choice', async () => {
    localStorage.setItem('tf-column-sorts:p1', JSON.stringify({ todo: 'priority' }))
    const user = userEvent.setup()
    await openBoard(user)
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo', 'Pick colors', 'Write copy'])
    await user.click(screen.getByRole('button', { name: 'Sort To do: Highest priority first' }))
    expect(screen.getByRole('menuitemradio', { name: 'Highest priority first' })).toHaveFocus()
    // Every choice has a picture as well as its words; the picture is not read out.
    for (const item of screen.getAllByRole('menuitemradio'))
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: 'Ending soonest' }))
    expect(JSON.parse(localStorage.getItem('tf-column-sorts:p1')!).todo).toBe('due')
  })

  it('lets a wide screen choose one row or two per row, and remembers it', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    const group = screen.getByRole('group', { name: 'Column layout' })
    const board = column(/^To do/).parentElement!
    const done = column(/^Done/)
    expect(within(group).getByRole('button', { name: 'One row' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(board).toHaveClass('xl:grid-cols-5')
    expect(done).not.toHaveClass('xl:last:col-span-2') // the same width as the others
    expect(board).toHaveClass('sm:grid-cols-2', 'lg:grid-cols-3')

    await user.click(within(group).getByRole('button', { name: 'Two per row' }))
    expect(within(group).getByRole('button', { name: 'Two per row' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(board).not.toHaveClass('xl:grid-cols-5')
    expect(board).toHaveClass('xl:grid-cols-2')
    expect(column(/^Done/)).toHaveClass('xl:last:col-span-2')
    expect(localStorage.getItem('tf-board-layout')).toBe('two')
  })

  it('dims the handles in a sorted column and says why', async () => {
    localStorage.setItem('tf-column-sorts:p1', JSON.stringify({ todo: 'priority' }))
    const user = userEvent.setup()
    await openBoard(user)
    const sorted = screen.getByRole('button', { name: 'Move task: Draw logo' })
    expect(sorted).toHaveClass('opacity-50')
    expect(sorted.getAttribute('title')).toMatch(/^Sorted automatically/)
    const arranged = screen.getByRole('button', { name: 'Move task: Build header' })
    expect(arranged).not.toHaveClass('opacity-50')
    expect(arranged).not.toHaveAttribute('title')
  })

  it('on a phone, column tabs show where the board is and move it', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    const tabs = screen.getByRole('tablist', { name: 'Columns' })
    expect(within(tabs).getAllByRole('tab')).toHaveLength(5)
    expect(within(tabs).getByRole('tab', { name: 'To do 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(within(tabs).getByRole('tab', { name: /^In review/ }))
    expect(within(tabs).getByRole('tab', { name: /^In review/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{ArrowRight}')
    const onHold = within(tabs).getByRole('tab', { name: /^On hold/ })
    expect(onHold).toHaveAttribute('aria-selected', 'true')
    expect(onHold).toHaveFocus()
    expect(onHold).toHaveAttribute('aria-controls', 'column-on_hold')
    expect(document.getElementById('column-on_hold')).toBe(column(/^On hold/))
  })

  it('sorts only the cards that pass the filters', async () => {
    localStorage.setItem('tf-column-sorts:p1', JSON.stringify({ todo: 'priority' }))
    const user = userEvent.setup()
    await openBoard(user)
    await user.selectOptions(screen.getByLabelText('Priority'), 'High')
    expect(titlesIn(column(/^To do/))).toEqual(['Draw logo'])
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
    await user.click(within(dialog).getByRole('checkbox', { name: 'Bob' }))
    await pickDay(user, 'End date (optional)', `${NEXT_YEAR}-03-04`)
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('POST /projects/p1/tasks')[0]!.body).toEqual({
      title: 'Test the app',
      description: 'All of it',
      priority: 'high',
      status: 'todo',
      assigneeIds: [BOB.userId],
      dueDate: `${NEXT_YEAR}-03-04`,
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
    expect(body).not.toHaveProperty('assigneeIds')
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
    expect(within(dialog).getByLabelText('End date (optional)')).toHaveFocus()
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

  it.each([
    ['the title', (card: HTMLElement) => within(card).getByRole('button', { name: 'Draw logo' })],
    ['the priority', (card: HTMLElement) => within(card).getByText('High')],
    ['the assignee', (card: HTMLElement) => within(card).getByText('Bob')],
    ['the card itself', (card: HTMLElement) => card.firstElementChild as HTMLElement],
    [
      'the drag handle',
      (card: HTMLElement) => within(card).getByRole('button', { name: 'Move task: Draw logo' }),
    ],
  ])('opens for editing when %s is clicked', async (_name, target) => {
    const user = userEvent.setup()
    await openBoard(user)
    const card = screen.getByRole('button', { name: 'Draw logo' }).closest('li')!
    await user.click(target(card))
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Draw logo')
  })

  it('opens from the keyboard with Enter on the title', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    screen.getByRole('button', { name: 'Draw logo' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
  })

  it('does not open from a click the keyboard produces on the drag handle', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    fireEvent.click(screen.getByRole('button', { name: 'Move task: Draw logo' }), { detail: 0 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens with the current values filled in', async () => {
    const user = userEvent.setup()
    const { dialog } = await openEdit(user, 'Draw logo')
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Draw logo')
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('high')
    expect(within(dialog).getByRole('checkbox', { name: 'Bob' })).toBeChecked()
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
    const tasks = [task('t1', 'Has both', { assigneeIds: [BOB.userId], dueDate: '2099-01-01' })]
    const { api, dialog } = await openEdit(user, 'Has both', tasks)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Bob' }))
    await user.click(within(dialog).getByRole('button', { name: 'Clear End date (optional)' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.hits('PATCH /tasks/t1')).toHaveLength(1))
    expect(api.hits('PATCH /tasks/t1')[0]!.body).toEqual({ assigneeIds: [], dueDate: null })
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
    const confirm = await screen.findByRole('dialog', { name: /^Delete task "/ })
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
    const confirm = await screen.findByRole('dialog', { name: /^Delete task "/ })
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

    await user.click(screen.getByRole('link', { name: 'Task trash' }))
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

  it('opens a deleted task to read, and restores it from there', async () => {
    const user = userEvent.setup()
    const api = fakeBackend({
      projects: [WEBSITE()],
      tasks: [
        task('d2', 'Plan launch', {
          description: 'Book the hall',
          priority: 'high',
          assigneeIds: [BOB.userId],
          startDate: '2099-03-10',
          dueDate: '2099-03-12',
          subtasks: [
            { id: 's1', title: 'Call venue', done: true },
            { id: 's2', title: 'Pay deposit', done: false },
          ],
          deletedAt: new Date().toISOString(),
        }),
      ],
    })
    await openSignedIn(user, '/projects/p1/trash')
    await user.click(await screen.findByRole('button', { name: 'Plan launch' }))
    // The same form as on the board, with everything as it was, and nothing can change.
    const dialog = await screen.findByRole('dialog', { name: 'Task in the trash' })
    expect(
      within(dialog).getByText('This task is in the trash. Restore it to change it.'),
    ).toBeInTheDocument()
    const fields: [HTMLElement, string][] = [
      [within(dialog).getByLabelText('Title'), 'Plan launch'],
      [within(dialog).getByLabelText(/^Description/), 'Book the hall'],
      [within(dialog).getByLabelText('Priority'), 'high'],
      [within(dialog).getByLabelText('Column'), 'todo'],
    ]
    for (const [field, value] of fields) {
      expect(field).toHaveValue(value)
      expect(field).toBeDisabled()
    }
    const done = within(dialog).getByRole('checkbox', { name: /Call venue/ })
    expect(done).toBeChecked()
    expect(done).toBeDisabled()
    expect(within(dialog).getByRole('checkbox', { name: /Pay deposit/ })).not.toBeChecked()
    const bob = await within(dialog).findByRole('checkbox', { name: /Bob/ })
    expect(bob).toBeChecked()
    expect(bob).toBeDisabled()
    expect(within(dialog).queryByLabelText('Add a subtask')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('"Plan launch" restored.')).toBeInTheDocument()
    expect(api.hits('POST /tasks/d2/restore')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the task without changing anything', async () => {
    const user = userEvent.setup()
    const api = fakeBackend({ projects: [WEBSITE()], tasks: trashed() })
    await openSignedIn(user, '/projects/p1/trash')
    await user.click(await screen.findByRole('button', { name: 'Old idea' }))
    const dialog = await screen.findByRole('dialog', { name: 'Task in the trash' })
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Old idea')
    // The locked fields are skipped: the focus starts on the first button that works, and Escape closes.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Old idea' })).toHaveFocus()
    expect(api.hits('POST /tasks/d1/restore')).toHaveLength(0)
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
    await openBoard(user, [task('t1', 'Bobs job', { assigneeIds: [BOB.userId] })], {
      projects: [project('p1', 'Website', { members: [BOB, CAROL] })],
    })
    expect(screen.getByTitle('Assigned to Bob')).toBeInTheDocument()
    await toggleAssignees(user, ['Unassigned'])
    expect(screen.queryByRole('button', { name: 'Bobs job' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Members \d+$/ }))
    const members = await screen.findByRole('dialog', { name: 'Members' })
    await user.click(await within(members).findByRole('button', { name: 'Actions for Bob' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove: Bob' }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Remove Bob from this project?' }),
      ).getByRole('button', { name: 'Remove' }),
    )
    // The task itself changed on the server (no assignee any more), so the board must reload it.
    expect(await screen.findByRole('button', { name: 'Bobs job' })).toBeInTheDocument()
  })
})

describe('several people and two dates on a task', () => {
  const SHARED = () =>
    task('s', 'Shared', {
      assigneeIds: [BOB.userId, ME.id],
      startDate: '2099-03-01',
      dueDate: '2099-03-04',
    })

  it('creates a task for several people, with a start and an end date', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('group', { name: 'Assigned to' })).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Title'), 'Together')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Bob' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Alice' }))
    await pickDay(user, 'Start date (optional)', `${NEXT_YEAR}-03-01`)
    await pickDay(user, 'End date (optional)', `${NEXT_YEAR}-03-01`)
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('POST /projects/p1/tasks')[0]!.body).toMatchObject({
      assigneeIds: [BOB.userId, ME.id],
      startDate: `${NEXT_YEAR}-03-01`,
      dueDate: `${NEXT_YEAR}-03-01`,
    })
  })

  it('stops each calendar at the other date, so the two can never be in the wrong order', async () => {
    const user = userEvent.setup()
    await openBoard(user)
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await pickDay(user, 'Start date (optional)', `${NEXT_YEAR}-03-04`)

    // The end date's calendar opens at the start date's month, with the days before it refused.
    await user.click(within(dialog).getByLabelText('End date (optional)'))
    let calendar = await screen.findByRole('dialog', { name: 'End date (optional)' })
    const day = (d: string) => calendar.querySelector(`[data-day="${NEXT_YEAR}-03-${d}"]`)!
    expect(day('03')).toHaveAttribute('aria-disabled', 'true')
    expect(day('04')).not.toHaveAttribute('aria-disabled') // one day: the same start and end are fine
    await user.click(day('10'))

    // And the other way round.
    await user.click(within(dialog).getByLabelText('Start date (optional)'))
    calendar = await screen.findByRole('dialog', { name: 'Start date (optional)' })
    expect(day('10')).not.toHaveAttribute('aria-disabled')
    expect(day('11')).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows the server refusing the two dates next to the end date, in words', async () => {
    const user = userEvent.setup()
    await openBoard(user, sample(), {
      routes: {
        'POST /projects/:id/tasks': () => ({
          status: 422,
          body: {
            code: 'validation_failed',
            message: 'x',
            fields: { dueDate: 'end_before_start' },
          },
        }),
      },
    })
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Backwards')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    expect(
      await within(dialog).findByText("The end date can't be before the start date."),
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText('End date (optional)')).toHaveFocus()
  })

  it('shows a date in the form the way a Thai reader expects, with a Buddhist-era year', async () => {
    const user = userEvent.setup()
    await openBoard(user, [task('d', 'Dated', { startDate: '2099-03-01' })])
    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    await user.click(screen.getByRole('button', { name: 'Dated' }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByLabelText('วันที่เริ่มงาน (ไม่บังคับ)')
    expect(field).toHaveTextContent('1 มี.ค. 2642')
    await user.click(field)
    const calendar = await screen.findByRole('dialog', { name: 'วันที่เริ่มงาน (ไม่บังคับ)' })
    expect(within(calendar).getByRole('grid', { name: 'มีนาคม พ.ศ. 2642' })).toBeInTheDocument()
    // Short names differ between browsers ("อา." or "อาทิตย์"), so only the start of the word is checked.
    expect(within(calendar).getAllByRole('columnheader')[0]).toHaveTextContent(/^อา/)
    expect(within(calendar).getByRole('button', { name: 'วันนี้' })).toBeInTheDocument()
  })

  it('shows every name when they fit on the line, in alphabetical order, and everyone on hover', async () => {
    await openBoard(userEvent.setup(), [SHARED()])
    const card = column(/^To do/)
    expect(within(card).getByText('Alice, Bob')).toBeInTheDocument()
    expect(within(card).queryByText('+1')).not.toBeInTheDocument()
    expect(within(card).getByText('Assigned to Alice, Bob')).toHaveClass('sr-only')
    expect(screen.getByTitle('Assigned to Alice, Bob')).toBeInTheDocument()
  })

  it('shows one name and how many more when the names do not fit', async () => {
    // The test browser has no layout: make the list 300px wide and its room 100px.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
    try {
      await openBoard(userEvent.setup(), [SHARED()])
      const card = column(/^To do/)
      expect(within(card).getByText('Alice')).toBeInTheDocument()
      expect(within(card).getByText('+1')).toBeInTheDocument()
      expect(within(card).getByText('Assigned to Alice, Bob')).toHaveClass('sr-only') // still everyone
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('shows both dates on the card, each marked for machines and in full on hover', async () => {
    await openBoard(userEvent.setup(), [SHARED()])
    // One month: "1–4 Mar 2099", the month written once.
    const start = document.querySelector('time[datetime="2099-03-01"]')!
    expect(start).toHaveTextContent(/^1$/)
    expect(start).toHaveAttribute('title', 'Starts 1 Mar 2099')
    expect(screen.getByText('4 Mar 2099')).toHaveAttribute('title', 'Ends 4 Mar 2099')
    expect(screen.getByText('–')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Starts')).toHaveClass('sr-only')
  })

  it('writes a range across months, or years, in full', async () => {
    await openBoard(userEvent.setup(), [
      task('m', 'Months', { startDate: '2099-10-28', dueDate: '2099-11-03', position: 1 }),
      task('y', 'Years', { startDate: '2099-12-30', dueDate: '2100-01-02', position: 2 }),
    ])
    expect(screen.getByText('28 Oct')).toHaveAttribute('datetime', '2099-10-28')
    expect(screen.getByText('3 Nov 2099')).toHaveAttribute('datetime', '2099-11-03')
    expect(screen.getByText('30 Dec 2099')).toHaveAttribute('datetime', '2099-12-30')
    expect(screen.getByText('2 Jan 2100')).toHaveAttribute('datetime', '2100-01-02')
  })

  it('writes one date when a task starts and ends on the same day', async () => {
    await openBoard(userEvent.setup(), [
      task('o', 'One day', { startDate: '2099-03-04', dueDate: '2099-03-04' }),
    ])
    expect(screen.getByText('4 Mar 2099')).toHaveAttribute('datetime', '2099-03-04')
    expect(screen.queryByText('–')).not.toBeInTheDocument()
  })

  it('says "Starts" out loud when a task has only a start date', async () => {
    await openBoard(userEvent.setup(), [task('s', 'Open-ended', { startDate: '2099-03-01' })])
    expect(screen.getByText('Starts')).not.toHaveClass('sr-only')
  })

  it('marks an end date alone with "Due" and a flag', async () => {
    await openBoard(userEvent.setup(), [task('d', 'Deadline', { dueDate: '2099-03-04' })])
    const date = screen.getByText('4 Mar 2099')
    expect(date).toHaveAttribute('title', 'Ends 4 Mar 2099')
    expect(date.parentElement).toHaveTextContent('Due 4 Mar 2099')
  })

  it('never shows a task on hold as overdue: it is waiting, not late', async () => {
    await openBoard(userEvent.setup(), [
      task('h', 'Held', {
        status: 'on_hold',
        holdReason: 'Waiting for the client',
        dueDate: '2020-01-01',
      }),
      task('l', 'Late', { dueDate: '2020-01-01' }),
    ])
    expect(within(column(/^On hold/)).queryByText('Overdue')).not.toBeInTheDocument()
    expect(within(column(/^To do/)).getByText('Overdue')).toBeInTheDocument()
    // The reason is one quiet line, in full on hover.
    const reason = within(column(/^On hold/)).getByTitle('Waiting for the client')
    expect(reason).toHaveClass('text-muted')
    expect(reason).not.toHaveClass('bg-lemon-bg')
  })

  it('finds a shared task under each of its people', async () => {
    const user = userEvent.setup()
    await openBoard(user, [SHARED(), task('o', 'Other')])
    for (const person of ['Bob', 'Alice']) {
      await toggleAssignees(user, [person])
      await waitFor(() => expect(titlesIn(column(/^To do/))).toEqual(['Shared']))
      await toggleAssignees(user, [person])
    }
    await toggleAssignees(user, ['Unassigned'])
    await waitFor(() => expect(titlesIn(column(/^To do/))).toEqual(['Other']))
  })

  it('sends the whole new list when someone is taken off, and nothing when the list ends up the same', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [SHARED()])
    await user.click(screen.getByRole('button', { name: 'Shared' }))
    let dialog = await screen.findByRole('dialog')
    const bob = within(dialog).getByRole('checkbox', { name: 'Bob' })
    expect(bob).toBeChecked()
    expect(within(dialog).getByLabelText('Start date (optional)')).toHaveTextContent('1 Mar 2099')
    await user.click(bob)
    await user.click(bob) // off and on again: nothing changed, in a different order
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('PATCH /tasks/s')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Shared' }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Bob' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.hits('PATCH /tasks/s')).toHaveLength(1))
    expect(api.hits('PATCH /tasks/s')[0]!.body).toEqual({ assigneeIds: [ME.id] })
  })

  it('keeps the others on a task when one person is removed from the project', async () => {
    const user = userEvent.setup()
    await openBoard(user, [SHARED()], {
      projects: [project('p1', 'Website', { members: [BOB] })],
    })
    await user.click(await screen.findByRole('button', { name: /^Members \d+$/ }))
    const members = await screen.findByRole('dialog', { name: 'Members' })
    await user.click(await within(members).findByRole('button', { name: 'Actions for Bob' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove: Bob' }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Remove Bob from this project?' }),
      ).getByRole('button', { name: 'Remove' }),
    )
    expect(await screen.findByTitle('Assigned to Alice')).toBeInTheDocument()
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })
})

describe('subtasks', () => {
  const lines = (...items: Array<[string, string, boolean]>) =>
    items.map(([id, title, done]) => ({ id, title, done }))
  const BACKEND = () =>
    task('b', 'Backend', {
      subtasks: lines(['s1', 'API route 1', true], ['s2', 'API route 2', false]),
    })

  async function openNewTask(user: U) {
    await user.click(screen.getByRole('button', { name: 'New task' }))
    return screen.findByRole('dialog')
  }
  async function openTask(user: U, title: string) {
    await user.click(screen.getByRole('button', { name: title }))
    return screen.findByRole('dialog')
  }

  it('creates a task with its subtasks, including the one still in the box', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [])
    const dialog = await openNewTask(user)
    await user.type(within(dialog).getByLabelText('Title'), 'Backend')
    const box = within(dialog).getByLabelText('Add a subtask')
    await user.type(box, 'API route 1{Enter}') // Enter adds a line, it does not submit the form
    expect(api.hits('POST /projects/p1/tasks')).toHaveLength(0)
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    await user.type(box, 'Oops{Enter}')
    await user.click(within(dialog).getByRole('button', { name: 'Remove subtask: Oops' }))
    expect(box).toHaveFocus() // the button is gone, and the keyboard stays in the dialog
    await user.type(box, 'API route 2')
    // Nothing to tick yet: the task does not exist.
    expect(within(dialog).queryByRole('checkbox', { name: /^Done:/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('POST /projects/p1/tasks')[0]!.body).toMatchObject({
      subtasks: ['API route 1', 'API route 2'],
    })
    expect(await screen.findByText('0/2')).toBeInTheDocument()
  })

  it('keeps one empty line of space while there are no subtasks, and says nothing about saving', async () => {
    const user = userEvent.setup()
    await openBoard(user, [task('p', 'Plain')])
    const dialog = await openTask(user, 'Plain')
    expect(within(dialog).getByTestId('subtasks-empty')).toHaveAttribute('aria-hidden', 'true')
    expect(within(dialog).queryByText(/saved right away/)).not.toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Add a subtask'), 'First{Enter}')
    expect(await within(dialog).findByRole('checkbox', { name: 'Done: First' })).toBeInTheDocument()
    expect(within(dialog).queryByTestId('subtasks-empty')).not.toBeInTheDocument()
  })

  it('does not send subtasks at all when there are none', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [])
    const dialog = await openNewTask(user)
    await user.type(within(dialog).getByLabelText('Title'), 'Plain')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(api.hits('POST /projects/p1/tasks')).toHaveLength(1))
    expect(api.hits('POST /projects/p1/tasks')[0]!.body).not.toHaveProperty('subtasks')
  })

  it('shows the progress on the card, in full for screen readers, and nothing without subtasks', async () => {
    await openBoard(userEvent.setup(), [BACKEND(), task('p', 'Plain', { position: 2048 })])
    const cards = within(column(/^To do/)).getAllByRole('listitem')
    expect(within(cards[0]!).getByText('1/2')).toBeInTheDocument()
    expect(within(cards[0]!).getByText('1 of 2 subtasks done')).toHaveClass('sr-only')
    expect(within(cards[1]!).queryByText(/subtasks done/)).not.toBeInTheDocument()
  })

  it('saves a tick right away, without pressing Save, and the card follows', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [BACKEND()])
    const dialog = await openTask(user, 'Backend')
    expect(within(dialog).getByRole('checkbox', { name: 'Done: API route 1' })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Done: API route 2' }))

    await waitFor(() => expect(api.hits('PATCH /tasks/b/subtasks/s2')).toHaveLength(1))
    expect(api.hits('PATCH /tasks/b/subtasks/s2')[0]!.body).toEqual({ done: true })
    expect(within(dialog).getByRole('checkbox', { name: 'Done: API route 2' })).toBeChecked()
    expect(within(column(/^To do/)).getByText('2/2')).toBeInTheDocument()

    // Cancel closes the form; the tick has already been saved.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(column(/^To do/)).getByText('2/2')).toBeInTheDocument()
    expect(api.hits('PATCH /tasks/b')).toHaveLength(0)
  })

  it('shows a tick in the same moment as the click, before the server has answered', async () => {
    const user = userEvent.setup()
    await openBoard(user, [BACKEND()])
    const dialog = await openTask(user, 'Backend')
    const box = within(dialog).getByRole('checkbox', { name: 'Done: API route 2' })
    fireEvent.click(box)
    expect(box).toBeChecked() // no waiting at all
    await waitFor(() => expect(within(column(/^To do/)).getByText('2/2')).toBeInTheDocument())
    expect(box).toBeChecked()
  })

  it('takes a tick back and says so when the server refuses it', async () => {
    const user = userEvent.setup()
    await openBoard(user, [BACKEND()], {
      routes: {
        'PATCH /tasks/:id/subtasks/:subtaskId': () => ({
          status: 500,
          body: { code: 'internal', message: 'x' },
        }),
      },
    })
    const dialog = await openTask(user, 'Backend')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Done: API route 2' }))
    expect(
      await within(dialog).findByText("Couldn't save the subtask. Please try again."),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: 'Done: API route 2' })).not.toBeChecked(),
    )
  })

  it('adds a line to a saved task right away, with the button or with Enter', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [BACKEND()])
    const dialog = await openTask(user, 'Backend')
    const box = within(dialog).getByLabelText('Add a subtask')
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()

    await user.type(box, ' API route 3 ')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(
      await within(dialog).findByRole('checkbox', { name: 'Done: API route 3' }),
    ).toBeInTheDocument()
    expect(box).toHaveValue('')

    await user.type(box, 'API route 4{Enter}')
    expect(
      await within(dialog).findByRole('checkbox', { name: 'Done: API route 4' }),
    ).toBeInTheDocument()
    expect(api.hits('POST /tasks/b/subtasks').map((hit) => hit.body)).toEqual([
      { title: 'API route 3' },
      { title: 'API route 4' },
    ])
    expect(api.hits('PATCH /tasks/b')).toHaveLength(0)
  })

  it('does not lose a line left in the box when the form is saved', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [BACKEND()])
    const dialog = await openTask(user, 'Backend')
    await user.type(within(dialog).getByLabelText('Add a subtask'), 'API route 3')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('POST /tasks/b/subtasks')[0]!.body).toEqual({ title: 'API route 3' })
  })

  it('keeps the dialog open and the line in the box when saving it fails', async () => {
    const user = userEvent.setup()
    await openBoard(user, [BACKEND()], {
      routes: {
        'POST /tasks/:id/subtasks': () => ({
          status: 422,
          body: { code: 'validation_failed', message: 'x', fields: { title: 'too_many_subtasks' } },
        }),
      },
    })
    const dialog = await openTask(user, 'Backend')
    const box = within(dialog).getByLabelText('Add a subtask')
    await user.type(box, 'One more')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(
      await within(dialog).findByText('A task can have at most 100 subtasks.'),
    ).toBeInTheDocument()
    expect(box).toHaveValue('One more')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renames a line when leaving it or on Enter, and ignores an empty or unchanged name', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [BACKEND()])
    const dialog = await openTask(user, 'Backend')
    const line = within(dialog).getByRole('textbox', { name: 'Rename subtask: API route 2' })

    await user.click(line)
    await user.tab() // unchanged
    await user.clear(line)
    await user.tab() // empty: the old name comes back
    expect(line).toHaveValue('API route 2')
    expect(api.hits('PATCH /tasks/b/subtasks/s2')).toHaveLength(0)

    await user.clear(line)
    await user.type(line, 'GET /users{Enter}')
    await waitFor(() => expect(api.hits('PATCH /tasks/b/subtasks/s2')).toHaveLength(1))
    expect(api.hits('PATCH /tasks/b/subtasks/s2')[0]!.body).toEqual({ title: 'GET /users' })
    expect(line).toHaveFocus() // Enter did not submit the form or drop the focus
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(api.hits('PATCH /tasks/b')).toHaveLength(0)
  })

  it('removes a line right away, and the keyboard stays in the dialog so Escape still closes it', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [BACKEND()])
    const dialog = await openTask(user, 'Backend')
    await user.click(within(dialog).getByRole('button', { name: 'Remove subtask: API route 1' }))
    expect(
      within(dialog).queryByRole('checkbox', { name: 'Done: API route 1' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Add a subtask')).toHaveFocus()
    await waitFor(() => expect(api.hits('DELETE /tasks/b/subtasks/s1')).toHaveLength(1))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(column(/^To do/)).getByText('0/1')).toBeInTheDocument()
  })

  it('never treats a subtask title as HTML', async () => {
    const title = '<img src=x onerror=alert(1)>'
    await openBoard(userEvent.setup(), [
      task('x', 'Careful', { subtasks: lines(['s', title, false]) }),
    ])
    const user = userEvent.setup()
    const dialog = await openTask(user, 'Careful')
    expect(within(dialog).getByRole('textbox', { name: `Rename subtask: ${title}` })).toHaveValue(
      title,
    )
    expect(dialog.querySelector('img')).toBeNull()
  })
})

describe('the hold reason in the task form', () => {
  const REASON = 'Why is it on hold?'

  it('keeps what was typed when the column goes away from On hold and back', async () => {
    const user = userEvent.setup()
    await openBoard(user, [])
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    const column = within(dialog).getByLabelText('Column')
    await user.selectOptions(column, 'On hold')
    await user.type(within(dialog).getByLabelText(REASON), 'Waiting for the client')
    await user.selectOptions(column, 'To do')
    expect(within(dialog).getByTestId('hold-reason')).toHaveAttribute('inert')
    await user.selectOptions(column, 'On hold')
    expect(within(dialog).getByLabelText(REASON)).toHaveValue('Waiting for the client')
  })

  it('keeps the buttons at the bottom of the dialog, and starts the description at three lines', async () => {
    const user = userEvent.setup()
    await openBoard(user, [])
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Create task' })
    expect(save.parentElement!.parentElement).toHaveClass('sticky', 'border-t', 'bg-surface')
    expect(within(dialog).getByLabelText('Description (optional)')).toHaveAttribute('rows', '3')
  })

  it('asks for a reason only when the column is On hold, and needs it', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [])
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Paused')
    // Hidden and out of reach (inert) until "On hold" is chosen.
    expect(within(dialog).getByTestId('hold-reason')).toHaveAttribute('inert')

    await user.selectOptions(within(dialog).getByLabelText('Column'), 'On hold')
    expect(within(dialog).getByTestId('hold-reason')).not.toHaveAttribute('inert')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    expect(await within(dialog).findByText('Enter why this task is on hold.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(REASON)).toHaveFocus()
    expect(api.hits('POST /projects/p1/tasks')).toHaveLength(0)

    await user.type(within(dialog).getByLabelText(REASON), ' Waiting ')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(api.hits('POST /projects/p1/tasks')).toHaveLength(1))
    expect(api.hits('POST /projects/p1/tasks')[0]!.body).toMatchObject({
      status: 'on_hold',
      holdReason: 'Waiting',
    })
  })

  it('does not send a reason for any other column, even one typed before changing it', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [])
    await user.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Changed my mind')
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'On hold')
    await user.type(within(dialog).getByLabelText(REASON), 'Waiting')
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'To do')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(api.hits('POST /projects/p1/tasks')).toHaveLength(1))
    expect(api.hits('POST /projects/p1/tasks')[0]!.body).not.toHaveProperty('holdReason')
  })

  it('moves a saved task on hold with the reason, in the move and not the edit', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [task('t', 'Work')])
    await user.click(screen.getByRole('button', { name: 'Work' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'On hold')
    await user.type(within(dialog).getByLabelText(REASON), 'Waiting')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.hits('POST /tasks/t/move')).toHaveLength(1))
    expect(api.hits('POST /tasks/t/move')[0]!.body).toEqual({
      status: 'on_hold',
      beforeTaskId: null,
      holdReason: 'Waiting',
    })
    expect(api.hits('PATCH /tasks/t')).toHaveLength(0)
  })

  it('changes the reason of a task on hold, and leaves it alone when it is the same', async () => {
    const user = userEvent.setup()
    const held = task('h', 'Held', { status: 'on_hold', holdReason: 'Waiting' })
    const api = await openBoard(user, [held])
    expect(within(column(/^On hold/)).getByText('Waiting')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Held' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(REASON)).toHaveValue('Waiting')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.hits('PATCH /tasks/h')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Held' }))
    dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText(REASON))
    await user.type(within(dialog).getByLabelText(REASON), 'Still waiting')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.hits('PATCH /tasks/h')).toHaveLength(1))
    expect(api.hits('PATCH /tasks/h')[0]!.body).toEqual({ holdReason: 'Still waiting' })
  })

  it('moves a task out of On hold without asking for a reason', async () => {
    const user = userEvent.setup()
    const api = await openBoard(user, [
      task('h', 'Held', { status: 'on_hold', holdReason: 'Waiting' }),
    ])
    await user.click(screen.getByRole('button', { name: 'Held' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Column'), 'In progress')
    expect(within(dialog).getByTestId('hold-reason')).toHaveAttribute('inert') // hidden, out of reach
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.hits('POST /tasks/h/move')).toHaveLength(1))
    expect(api.hits('POST /tasks/h/move')[0]!.body).toEqual({
      status: 'in_progress',
      beforeTaskId: null,
    })
  })

  it('works in Thai', async () => {
    const user = userEvent.setup()
    await openBoard(user, [])
    await user.click(screen.getByRole('button', { name: 'Switch language to ไทย' }))
    expect(screen.getByRole('region', { name: 'พักงาน 0 งาน' })).toBeInTheDocument()
  })
})
