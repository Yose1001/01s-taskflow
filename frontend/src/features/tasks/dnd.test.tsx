import type { DndContextProps } from '@dnd-kit/core'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../../App'
import type { Task } from '../../api/types'
import { fakeBackend, project, task } from '../../test/fakeBackend'
import { renderApp } from '../../test/render'

// A real drag needs a layout engine (sizes and positions), which the test browser (jsdom) does not have.
// So these tests catch the board's own drop handler and call it exactly as dnd-kit would at the end of a drag.
// What the library itself does (pointer, touch and keyboard dragging) is checked by hand in a real browser.
const caught = vi.hoisted(() => ({ props: null as DndContextProps | null }))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const React = await import('react')
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      caught.props = props
      return React.createElement(actual.DndContext, props)
    },
  }
})

type Rect = { top: number; height: number }

/** What dnd-kit hands the board when a drag ends. */
function dropOn(activeId: string, overId: string | null, dragged: Rect | null = null) {
  const event = {
    active: { id: activeId, rect: { current: { translated: dragged, initial: null } } },
    over: overId === null ? null : { id: overId, rect: { top: 0, height: 100 } },
  }
  act(() => caught.props!.onDragEnd!(event as never))
}

const sample = (): Task[] => [
  task('t1', 'Draw logo', { position: 1024, priority: 'high' }),
  task('t2', 'Write copy', { position: 2048, priority: 'low' }),
  task('t3', 'Pick colors', { position: 3072 }),
  task('t4', 'Build header', { status: 'in_progress', position: 1024, priority: 'high' }),
  task('t5', 'Ship it', { status: 'done', position: 1024 }),
]

async function openBoard(extra: Parameters<typeof fakeBackend>[0] = {}) {
  const api = fakeBackend({ projects: [project('p1', 'Website')], tasks: sample(), ...extra })
  const user = userEvent.setup()
  renderApp(<AppRoutes />, { route: '/projects/p1' })
  await user.type(screen.getByLabelText('Email'), 'alice@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  await screen.findByRole('region', { name: /^To do,/ })
  return { api, user }
}

const titlesIn = (name: RegExp) =>
  within(screen.getByRole('region', { name }))
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('button:not([aria-label])')?.textContent)
    .filter(Boolean)

const moves = (api: Awaited<ReturnType<typeof openBoard>>['api'], id: string) =>
  api.hits(`POST /tasks/${id}/move`).map((c) => c.body)

describe('dropping a card', () => {
  it('every card has a drag handle with a clear name (keyboard and screen reader users)', async () => {
    await openBoard()
    expect(screen.getByRole('button', { name: 'Move task: Draw logo' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Move task:/ })).toHaveLength(5)
  })

  it('down inside a column: lands after the card it was dropped on', async () => {
    const { api } = await openBoard()
    dropOn('t1', 't2')
    await waitFor(() => expect(moves(api, 't1')).toHaveLength(1))
    expect(moves(api, 't1')[0]).toEqual({ status: 'todo', beforeTaskId: 't3' })
    expect(titlesIn(/^To do/)).toEqual(['Write copy', 'Draw logo', 'Pick colors'])
  })

  it('down onto the last card: goes to the end', async () => {
    const { api } = await openBoard()
    dropOn('t1', 't3')
    await waitFor(() => expect(moves(api, 't1')).toHaveLength(1))
    expect(moves(api, 't1')[0]).toEqual({ status: 'todo', beforeTaskId: null })
    expect(titlesIn(/^To do/)).toEqual(['Write copy', 'Pick colors', 'Draw logo'])
  })

  it('up inside a column: lands before the card it was dropped on', async () => {
    const { api } = await openBoard()
    dropOn('t3', 't1')
    await waitFor(() => expect(moves(api, 't3')).toHaveLength(1))
    expect(moves(api, 't3')[0]).toEqual({ status: 'todo', beforeTaskId: 't1' })
    expect(titlesIn(/^To do/)).toEqual(['Pick colors', 'Draw logo', 'Write copy'])
  })

  it('into another column, on a card: lands in front of it', async () => {
    const { api } = await openBoard()
    dropOn('t2', 't4')
    await waitFor(() => expect(moves(api, 't2')).toHaveLength(1))
    expect(moves(api, 't2')[0]).toEqual({ status: 'in_progress', beforeTaskId: 't4' })
    expect(titlesIn(/^In progress/)).toEqual(['Write copy', 'Build header'])
    expect(titlesIn(/^To do/)).toEqual(['Draw logo', 'Pick colors'])
  })

  it('into another column, on the lower half of a card: lands behind it', async () => {
    const { api } = await openBoard()
    dropOn('t2', 't4', { top: 80, height: 40 }) // its middle (100) is below the middle of the target (50)
    await waitFor(() => expect(moves(api, 't2')).toHaveLength(1))
    expect(moves(api, 't2')[0]).toEqual({ status: 'in_progress', beforeTaskId: null })
    expect(titlesIn(/^In progress/)).toEqual(['Build header', 'Write copy'])
  })

  it('onto an empty column: goes in as its only card', async () => {
    const { api } = await openBoard()
    dropOn('t1', 'column:review')
    await waitFor(() => expect(moves(api, 't1')).toHaveLength(1))
    expect(moves(api, 't1')[0]).toEqual({ status: 'review', beforeTaskId: null })
    expect(titlesIn(/^In review/)).toEqual(['Draw logo'])
  })

  it('does nothing when dropped outside every column, or on itself', async () => {
    const { api } = await openBoard()
    dropOn('t1', null)
    dropOn('t1', 't1')
    dropOn('t3', 'column:todo') // already last in that column
    await new Promise((r) => setTimeout(r, 30))
    expect(api.calls.filter((c) => c.pathname.endsWith('/move'))).toHaveLength(0)
    expect(titlesIn(/^To do/)).toEqual(['Draw logo', 'Write copy', 'Pick colors'])
  })

  it('changes the board at once, before the server has answered', async () => {
    let answer: (r: { body: unknown }) => void = () => {}
    const { api } = await openBoard({
      routes: {
        'POST /tasks/:id/move': () => new Promise((resolve) => (answer = resolve)),
      },
    })
    dropOn('t3', 't1')
    await waitFor(() =>
      expect(titlesIn(/^To do/)).toEqual(['Pick colors', 'Draw logo', 'Write copy']),
    )
    expect(api.hits('POST /tasks/t3/move')).toHaveLength(1) // still waiting for the answer
    answer({ body: {} })
  })

  it('puts the card back and says so when the server refuses', async () => {
    const { api } = await openBoard({
      routes: {
        'POST /tasks/:id/move': () => ({
          status: 422,
          body: {
            code: 'validation_failed',
            message: 'x',
            fields: { beforeTaskId: 'invalid_before_task' },
          },
        }),
      },
    })
    dropOn('t3', 't1')
    await waitFor(() => expect(api.hits('POST /tasks/t3/move')).toHaveLength(1))
    expect(
      await screen.findByText('The task could not be moved, so it went back.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(titlesIn(/^To do/)).toEqual(['Draw logo', 'Write copy', 'Pick colors']),
    )
  })

  it('puts the card back at once, without waiting for the reload that follows', async () => {
    const { api } = await openBoard({
      routes: {
        'POST /tasks/:id/move': () => ({
          status: 422,
          body: {
            code: 'validation_failed',
            message: 'x',
            fields: { beforeTaskId: 'invalid_before_task' },
          },
        }),
      },
    })
    const original = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation((input, init) =>
      String(input).includes('/tasks?') ? new Promise<Response>(() => {}) : original(input, init),
    )
    dropOn('t3', 't1')
    expect(
      await screen.findByText('The task could not be moved, so it went back.'),
    ).toBeInTheDocument()
    expect(titlesIn(/^To do/)).toEqual(['Draw logo', 'Write copy', 'Pick colors'])
  })

  it('puts the card back when the connection fails', async () => {
    const { api } = await openBoard()
    const original = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/move')) throw new TypeError('network down')
      return original(input, init)
    })
    dropOn('t2', 't4')
    expect(
      await screen.findByText('The task could not be moved, so it went back.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(titlesIn(/^To do/)).toEqual(['Draw logo', 'Write copy', 'Pick colors']),
    )
    expect(titlesIn(/^In progress/)).toEqual(['Build header'])
  })

  it('with a filter on, it goes by the cards that are visible', async () => {
    const { api, user } = await openBoard()
    await user.selectOptions(screen.getByLabelText('Priority'), 'High')
    expect(titlesIn(/^To do/)).toEqual(['Draw logo']) // Write copy (low) is hidden
    dropOn('t4', 't1')
    await waitFor(() => expect(moves(api, 't4')).toHaveLength(1))
    expect(moves(api, 't4')[0]).toEqual({ status: 'todo', beforeTaskId: 't1' })
  })
})

describe('screen reader announcements', () => {
  it('say which task was picked up, where it is, and where it was dropped (in the UI language)', async () => {
    await openBoard()
    const { announcements, screenReaderInstructions } = caught.props!.accessibility!
    const active = { id: 't1' } as never
    expect(announcements!.onDragStart!({ active } as never)).toBe('Picked up "Draw logo".')
    expect(announcements!.onDragOver!({ active, over: { id: 't4' } } as never)).toBe(
      '"Draw logo" is over In progress.',
    )
    expect(announcements!.onDragEnd!({ active, over: { id: 'column:done' } } as never)).toBe(
      '"Draw logo" dropped in Done.',
    )
    expect(announcements!.onDragCancel!({ active } as never)).toBe(
      'Moving "Draw logo" was cancelled.',
    )
    expect(screenReaderInstructions!.draggable).toMatch(/Space or Enter/)
  })

  it('stay quiet about things that are not on the board', async () => {
    await openBoard()
    const { announcements } = caught.props!.accessibility!
    expect(announcements!.onDragStart!({ active: { id: 'ghost' } } as never)).toBeUndefined()
    expect(
      announcements!.onDragOver!({ active: { id: 't1' }, over: { id: 'ghost' } } as never),
    ).toBeUndefined()
  })
})
