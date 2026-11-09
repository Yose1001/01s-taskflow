import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'
import { ICON_NAMES } from './iconPaths'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe('Icon', () => {
  it.each(ICON_NAMES)('%s is hidden from screen readers and follows the text color', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('stroke-width', '2')
    expect(svg).toHaveAttribute('width', '16') // the default size
    expect(svg.childElementCount).toBeGreaterThan(0)
  })

  it('takes a size', () => {
    const { container } = render(<Icon name="trash" size={24} />)
    expect(container.querySelector('svg')).toHaveAttribute('height', '24')
  })

  it('has replaced every text symbol that was used as an icon', () => {
    const symbols = /[○◐◎✓▽◇△⠿⚠★←●▴▾✕]/
    const offenders = sourceFiles(join(process.cwd(), 'src')).filter(
      (path) =>
        path !== join(process.cwd(), 'src', 'components', 'Icon.test.tsx') &&
        symbols.test(readFileSync(path, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
