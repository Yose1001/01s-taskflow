import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Menu } from './Menu'

function setup() {
  const first = vi.fn()
  const second = vi.fn()
  const third = vi.fn()
  render(
    <div>
      <button type="button">outside</button>
      <Menu
        label="More"
        trigger="..."
        triggerClassName=""
        items={[
          { key: 'a', label: 'First', onSelect: first },
          { key: 'b', label: 'Second', onSelect: second },
          { key: 'c', label: 'Remove', ariaLabel: 'Remove: Bob', tone: 'danger', onSelect: third },
        ]}
      />
    </div>,
  )
  return {
    user: userEvent.setup(),
    button: screen.getByRole('button', { name: 'More' }),
    first,
    third,
  }
}

describe('Menu with choices', () => {
  it('marks the chosen item, starts on it, and places a floating menu against the window', async () => {
    const user = userEvent.setup()
    render(
      <Menu
        floating
        label="Sort"
        trigger="..."
        triggerClassName=""
        items={[
          { key: 'a', label: 'A', checked: false, onSelect: () => {} },
          { key: 'b', label: 'B', checked: true, onSelect: () => {} },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Sort' }))
    const chosen = screen.getByRole('menuitemradio', { name: 'B' })
    expect(chosen).toHaveAttribute('aria-checked', 'true')
    expect(chosen).toHaveFocus()
    expect(screen.getByRole('menuitemradio', { name: 'A' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('menu').parentElement).toHaveClass('fixed')
  })

  it('a floating menu closes when anything scrolls', async () => {
    const user = userEvent.setup()
    render(
      <Menu
        floating
        label="Sort"
        trigger="..."
        triggerClassName=""
        items={[{ key: 'a', label: 'A', checked: true, onSelect: () => {} }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Sort' }))
    act(() => void window.dispatchEvent(new Event('scroll')))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('Menu', () => {
  it('is closed at first and says it opens a menu', () => {
    const { button } = setup()
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens with the focus on the first item, and only that item is in the Tab order', async () => {
    const { user, button } = setup()
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves with the arrow keys, Home and End, wrapping around', async () => {
    const { user, button } = setup()
    await user.click(button)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Remove: Bob' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Remove: Bob' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
  })

  it('closes with Escape and gives the focus back to the button', async () => {
    const { user, button, first } = setup()
    await user.click(button)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(first).not.toHaveBeenCalled()
  })

  it('runs the chosen item with Enter or a click, then closes', async () => {
    const { user, button, first, third } = setup()
    await user.click(button)
    await user.keyboard('{Enter}')
    expect(first).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button)
    await user.click(screen.getByRole('menuitem', { name: 'Remove: Bob' }))
    expect(third).toHaveBeenCalledOnce()
    expect(button).toHaveFocus()
  })

  it('closes with a click outside or Tab', async () => {
    const { user, button } = setup()
    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button)
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
