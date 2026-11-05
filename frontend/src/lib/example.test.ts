import { describe, expect, it } from 'vitest'
import { clamp } from './example'

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })
  it('limits values outside the range', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
})
