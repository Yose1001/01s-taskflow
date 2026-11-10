import { describe, expect, it } from 'vitest'
import { loadBoardLayout, saveBoardLayout } from './boardLayout'

describe('board layout', () => {
  it('is one row until the person chooses', () => {
    expect(loadBoardLayout()).toBe('row')
  })

  it('remembers the choice', () => {
    saveBoardLayout('two')
    expect(loadBoardLayout()).toBe('two')
    saveBoardLayout('row')
    expect(loadBoardLayout()).toBe('row')
  })

  it('ignores anything else found in storage', () => {
    localStorage.setItem('tf-board-layout', 'sideways')
    expect(loadBoardLayout()).toBe('row')
  })
})
