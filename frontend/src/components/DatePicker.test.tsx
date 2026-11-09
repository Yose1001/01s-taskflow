import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { today } from '../lib/calendar'
import { DatePicker } from './DatePicker'

const LABEL = 'End date'

function Field({
  initial = '',
  min,
  max,
  onChange,
}: {
  initial?: string
  min?: string
  max?: string
  onChange?: (day: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DatePicker
        id="due"
        label={LABEL}
        value={value}
        min={min}
        max={max}
        onChange={(day) => {
          setValue(day)
          onChange?.(day)
        }}
      />
      <button type="button">Next thing on the page</button>
    </>
  )
}

// By id: while the calendar is open, it carries the same label.
const field = () => document.getElementById('due')!
const openCalendar = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(field())
  return screen.findByRole('dialog', { name: LABEL })
}
const dayButton = (calendar: HTMLElement, day: string) =>
  calendar.querySelector<HTMLElement>(`[data-day="${day}"]`)!

describe('DatePicker', () => {
  it('shows the chosen day in words, or asks for one', () => {
    const { unmount } = render(<Field />)
    expect(field()).toHaveTextContent('Choose a date')
    expect(screen.queryByRole('button', { name: `Clear ${LABEL}` })).not.toBeInTheDocument()
    unmount()
    render(<Field initial="2026-12-20" />)
    expect(field()).toHaveTextContent('20 Dec 2026')
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on the chosen day with the focus on it, and marks it', async () => {
    const user = userEvent.setup()
    render(<Field initial="2026-12-20" />)
    const calendar = await openCalendar(user)
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    expect(within(calendar).getByRole('grid', { name: 'December 2026' })).toBeInTheDocument()
    const day = within(calendar).getByRole('button', { name: 'Sunday, 20 December 2026' })
    expect(day).toHaveFocus()
    expect(day.closest('td')).toHaveAttribute('aria-selected', 'true')
  })

  it('opens on today when nothing is chosen, and marks today', async () => {
    const user = userEvent.setup()
    render(<Field />)
    const calendar = await openCalendar(user)
    const day = dayButton(calendar, today())
    expect(day).toHaveFocus()
    expect(day).toHaveAttribute('aria-current', 'date')
  })

  it('picks a day with a click, closes, and gives the focus back', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Field initial="2026-12-20" onChange={onChange} />)
    const calendar = await openCalendar(user)
    await user.click(dayButton(calendar, '2026-12-25'))
    expect(onChange).toHaveBeenCalledWith('2026-12-25')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(field()).toHaveTextContent('25 Dec 2026')
    expect(field()).toHaveFocus()
  })

  it('works with the keyboard alone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Field initial="2026-12-16" onChange={onChange} />) // a Wednesday
    field().focus()
    await user.keyboard('{Enter}')
    const calendar = await screen.findByRole('dialog', { name: LABEL })
    const at = (day: string) => expect(dayButton(calendar, day)).toHaveFocus()
    at('2026-12-16')

    await user.keyboard('{ArrowRight}')
    at('2026-12-17')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    at('2026-12-15')
    await user.keyboard('{ArrowDown}')
    at('2026-12-22')
    await user.keyboard('{ArrowUp}')
    at('2026-12-15')
    await user.keyboard('{Home}')
    at('2026-12-13')
    await user.keyboard('{End}')
    at('2026-12-19')
    await user.keyboard('{PageDown}')
    at('2027-01-19')
    expect(within(calendar).getByRole('grid', { name: 'January 2027' })).toBeInTheDocument()
    await user.keyboard('{PageUp}')
    at('2026-12-19')
    await user.keyboard('{Shift>}{PageDown}{/Shift}')
    at('2027-12-19')
    await user.keyboard('{Shift>}{PageUp}{/Shift}')
    at('2026-12-19')

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('2026-12-19')
    expect(field()).toHaveFocus()
  })

  it('crosses into the next month with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<Field initial="2026-12-31" />)
    const calendar = await openCalendar(user)
    await user.keyboard('{ArrowRight}')
    expect(dayButton(calendar, '2027-01-01')).toHaveFocus()
    expect(within(calendar).getByRole('grid', { name: 'January 2027' })).toBeInTheDocument()
  })

  it('only one day can be reached with Tab, so the grid is one stop', async () => {
    const user = userEvent.setup()
    render(<Field initial="2026-12-20" />)
    const calendar = await openCalendar(user)
    const reachable = [...calendar.querySelectorAll('[data-day]')].filter(
      (day) => day.getAttribute('tabindex') === '0',
    )
    expect(reachable).toHaveLength(1)
    await user.tab()
    expect(within(calendar).getByRole('button', { name: 'Today' })).toHaveFocus()
  })

  it('closes on Escape without choosing, and the Escape goes no further', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <Field initial="2026-12-20" onChange={onChange} />
      </div>,
    )
    await openCalendar(user)
    await user.keyboard('{ArrowRight}{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(field()).toHaveFocus()
    expect(outer).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
  })

  it('closes when Tab leaves it or on a click outside, not on a click inside', async () => {
    const user = userEvent.setup()
    render(<Field initial="2026-12-20" />)
    let calendar = await openCalendar(user)
    await user.click(within(calendar).getByRole('grid').querySelector('th')!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next thing on the page' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    calendar = await openCalendar(user)
    await user.tab() // Today
    await user.tab() // off the end of the calendar
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calendar).not.toBeInTheDocument()
  })

  it('changes month with the buttons and the lists, keeping the focus where it is', async () => {
    const user = userEvent.setup()
    render(<Field initial="2026-01-31" />)
    const calendar = await openCalendar(user)
    const next = within(calendar).getByRole('button', { name: 'Next month' })
    await user.click(next)
    expect(within(calendar).getByRole('grid', { name: 'February 2026' })).toBeInTheDocument()
    expect(next).toHaveFocus()
    await user.click(within(calendar).getByRole('button', { name: 'Previous month' }))
    expect(within(calendar).getByRole('grid', { name: 'January 2026' })).toBeInTheDocument()

    await user.selectOptions(within(calendar).getByLabelText('Month'), 'June')
    expect(within(calendar).getByRole('grid', { name: 'June 2026' })).toBeInTheDocument()
    await user.selectOptions(within(calendar).getByLabelText('Year'), '2027')
    expect(within(calendar).getByRole('grid', { name: 'June 2027' })).toBeInTheDocument()
  })

  it('still offers a year far from today when that is the chosen one', async () => {
    const user = userEvent.setup()
    render(<Field initial="2099-03-04" />)
    const calendar = await openCalendar(user)
    expect(within(calendar).getByLabelText('Year')).toHaveValue('2099')
  })

  it('refuses days outside the limits, but the keyboard can pass over them', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Field min="2026-12-10" max="2026-12-20" onChange={onChange} />)
    const calendar = await openCalendar(user)
    // Today is outside, so it opens on the limit.
    expect(within(calendar).getByRole('grid', { name: 'December 2026' })).toBeInTheDocument()
    const before = dayButton(calendar, '2026-12-09')
    expect(before).toHaveAttribute('aria-disabled', 'true')
    expect(dayButton(calendar, '2026-12-10')).not.toHaveAttribute('aria-disabled')
    expect(dayButton(calendar, '2026-12-20')).not.toHaveAttribute('aria-disabled')
    expect(dayButton(calendar, '2026-12-21')).toHaveAttribute('aria-disabled', 'true')
    expect(within(calendar).getByRole('button', { name: 'Today' })).toBeDisabled()

    await user.click(before)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    dayButton(calendar, '2026-12-10').focus()
    await user.keyboard('{ArrowLeft}')
    expect(before).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the Today button picks today', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Field onChange={onChange} />)
    const calendar = await openCalendar(user)
    await user.click(within(calendar).getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenCalledWith(today())
  })

  it('clears the day and gives the focus back to the field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Field initial="2026-12-20" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: `Clear ${LABEL}` }))
    expect(onChange).toHaveBeenCalledWith('')
    expect(field()).toHaveTextContent('Choose a date')
    expect(field()).toHaveFocus()
  })

  it('shows an error next to the field and tells screen readers', () => {
    render(<DatePicker id="due" label={LABEL} value="" onChange={() => {}} error="Too late" />)
    const message = screen.getByText('Too late')
    expect(field()).toHaveAttribute('aria-describedby', message.id)
  })
})
