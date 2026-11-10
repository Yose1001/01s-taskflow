import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../../App'
import {
  BOB,
  calendarEvent,
  fakeBackend,
  notification,
  project,
  task,
} from '../../test/fakeBackend'
import { renderApp } from '../../test/render'

type U = ReturnType<typeof userEvent.setup>

/** Opens the app at `route` and signs in as Alice. */
async function openSignedIn(user: U, route: string) {
  const view = renderApp(<AppRoutes />, { route })
  await user.type(screen.getByLabelText('Email'), 'alice@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  return view
}

const WEBSITE = () => project('p1', 'Website', { members: [BOB] })

async function openCalendar(user: U, extra: Parameters<typeof fakeBackend>[0] = {}) {
  const api = fakeBackend({
    projects: [WEBSITE()],
    tasks: [
      task('t1', 'Ship the site', { dueDate: '2099-03-15' }),
      task('t2', 'Design', {
        startDate: '2099-03-10',
        dueDate: '2099-03-20',
        status: 'in_progress',
      }),
    ],
    events: [
      calendarEvent('e1', 'Client demo', '2099-03-15', {
        projectId: 'p1',
        projectName: 'Website',
        remindDays: [0, 1],
        note: 'Bring the slides',
      }),
      calendarEvent('e2', 'Not mine to change', '2099-03-15', {
        projectId: 'p1',
        projectName: 'Website',
        canEdit: false,
      }),
    ],
    ...extra,
  })
  await openSignedIn(user, '/calendar?day=2099-03-15')
  await screen.findByRole('grid', { name: 'March 2099' })
  return api
}

const panel = () => screen.getByRole('region', { name: 'Sunday, 15 March 2099' })

describe('the calendar page', () => {
  it('shows the month of the chosen day, with important days and tasks in full beside it', async () => {
    await openCalendar(userEvent.setup())
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument()
    expect(document.title).toMatch(/^Calendar/)
    const day = screen.getByRole('button', { name: /^Sunday, 15 March 2099/ })
    expect(day).toHaveAccessibleName('Sunday, 15 March 2099, 2 important days, 1 tasks')
    expect(day.closest('[role=gridcell]')).toHaveAttribute('aria-selected', 'true')
    expect(day).toHaveAttribute('tabindex', '0')

    const chosen = within(panel())
    expect(chosen.getByText('Client demo')).toBeInTheDocument()
    expect(chosen.getByText('Bring the slides')).toBeInTheDocument()
    expect(chosen.getByText('On the day, 1 day before')).toBeInTheDocument()
    expect(chosen.getByRole('link', { name: /Ship the site/ })).toHaveAttribute(
      'href',
      '/projects/p1',
    )
    // Only what the person may change has an edit button.
    expect(chosen.getByRole('button', { name: 'Edit Client demo' })).toBeInTheDocument()
    expect(
      chosen.queryByRole('button', { name: 'Edit Not mine to change' }),
    ).not.toBeInTheDocument()
  })

  it('shows a task on its start and end days only, and can hide tasks', async () => {
    const user = userEvent.setup()
    await openCalendar(user)
    expect(
      screen.getByRole('button', { name: /^Tuesday, 10 March 2099, 1 tasks$/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^Friday, 20 March 2099, 1 tasks$/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thursday, 12 March 2099' })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Show tasks' }))
    expect(screen.getByRole('button', { name: 'Tuesday, 10 March 2099' })).toBeInTheDocument()
    expect(within(panel()).queryByRole('link', { name: /Ship the site/ })).not.toBeInTheDocument()
    expect(localStorage.getItem('tf-calendar-show-tasks')).toBe('false')
  })

  it('moves through the days with the keyboard, into the next month too', async () => {
    const user = userEvent.setup()
    await openCalendar(user)
    screen.getByRole('button', { name: /^Sunday, 15 March 2099/ }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: /^Monday, 16 March 2099/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /^Monday, 23 March 2099/ })).toHaveFocus()
    await user.keyboard('{PageDown}')
    expect(await screen.findByRole('grid', { name: 'April 2099' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Thursday, 23 April 2099/ })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByRole('grid', { name: 'March 2099' })).toBeInTheDocument()
  })

  it('adds a personal day with the chosen reminders', async () => {
    const user = userEvent.setup()
    const api = await openCalendar(user)
    await user.click(screen.getByRole('button', { name: 'Add an important day' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an important day' })
    // On the day and the day before, unless changed.
    expect(within(dialog).getByRole('checkbox', { name: 'On the day' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: '1 day before' })).toBeChecked()

    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(within(dialog).getByText('This field is required.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveFocus()

    await user.type(within(dialog).getByLabelText('Name'), '  Dentist  ')
    await user.click(within(dialog).getByRole('checkbox', { name: 'On the day' }))
    await user.click(within(dialog).getByRole('checkbox', { name: '1 week before' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.hits('POST /events')).toHaveLength(1))
    expect(api.hits('POST /events')[0]!.body).toEqual({
      title: 'Dentist',
      note: '',
      day: '2099-03-15',
      remindDays: [1, 7],
    })
    expect(await screen.findByText('"Dentist" was added.')).toBeInTheDocument()
    expect(await within(panel()).findByText('Dentist')).toBeInTheDocument()
  })

  it('adds a day to a project the person is in, for every member', async () => {
    const user = userEvent.setup()
    const api = await openCalendar(user)
    await user.click(screen.getByRole('button', { name: 'Add an important day' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an important day' })
    await user.type(within(dialog).getByLabelText('Name'), 'Launch')
    const belongs = within(dialog).getByLabelText('Belongs to')
    await within(belongs).findByRole('option', { name: 'Website' })
    await user.selectOptions(belongs, 'Website')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(api.hits('POST /events')).toHaveLength(1))
    expect(api.hits('POST /events')[0]!.body).toMatchObject({ title: 'Launch', projectId: 'p1' })
  })

  it('changes only what was changed, and deletes after asking', async () => {
    const user = userEvent.setup()
    const api = await openCalendar(user)
    await user.click(within(panel()).getByRole('button', { name: 'Edit Client demo' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit important day' })
    expect(within(dialog).getByText('Website')).toBeInTheDocument() // where it belongs is fixed
    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Client demo day')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.hits('PATCH /events/e1')).toHaveLength(1))
    expect(api.hits('PATCH /events/e1')[0]!.body).toEqual({ title: 'Client demo day' })

    await user.click(await within(panel()).findByRole('button', { name: 'Edit Client demo day' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit important day' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete "Client demo day"?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete for good' }))
    await waitFor(() => expect(api.hits('DELETE /events/e1')).toHaveLength(1))
    expect(await screen.findByText('"Client demo day" was deleted.')).toBeInTheDocument()
  })
})

describe('the notification bell', () => {
  it('counts unread reminders, opens their day, and marks them read', async () => {
    const user = userEvent.setup()
    const api = fakeBackend({
      projects: [WEBSITE()],
      notifications: [
        notification('n1', 'Client demo', '2099-03-15', {
          projectName: 'Website',
          projectId: 'p1',
        }),
        notification('n2', 'Dentist', '2099-03-20'),
        notification('n3', 'Old one', '2099-01-01', { readAt: '2099-01-01T01:00:00Z' }),
      ],
    })
    await openSignedIn(user, '/')
    const bell = await screen.findByRole('button', { name: 'Notifications (2 unread)' })
    await user.click(bell)
    const menu = screen.getByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.getAttribute('aria-label') ?? i.textContent),
    ).toEqual([
      expect.stringMatching(/^Unread, Client demo, In \d+ days \(15 Mar 2099\), Website$/),
      expect.stringMatching(/^Unread, Dentist, In \d+ days \(20 Mar 2099\), Personal$/),
      expect.stringMatching(/^Old one, Passed|^Old one, In \d+ days/),
      'Mark all as read',
      'Open the calendar',
    ])

    await user.click(within(menu).getAllByRole('menuitem')[0]!)
    await waitFor(() => expect(api.hits('POST /notifications/read')).toHaveLength(1))
    expect(api.hits('POST /notifications/read')[0]!.body).toEqual({ ids: ['n1'] })
    expect(await screen.findByRole('grid', { name: 'March 2099' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sunday, 15 March 2099' })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Notifications (1 unread)' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }))
    await user.click(screen.getByRole('menuitem', { name: 'Mark all as read' }))
    await waitFor(() => expect(api.hits('POST /notifications/read')).toHaveLength(2))
    expect(api.hits('POST /notifications/read')[1]!.body).toEqual({})
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('has a calendar link in the top bar, and says when there is nothing yet', async () => {
    const user = userEvent.setup()
    fakeBackend({ projects: [WEBSITE()] })
    await openSignedIn(user, '/')
    expect(await screen.findByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    )
    await user.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open the calendar'])
  })
})
