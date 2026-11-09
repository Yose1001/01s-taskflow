import type { PointerEvent as ReactPointerEvent } from 'react'
import { describe, expect, it } from 'vitest'
import { MouseOrPenSensor } from './sensors'

function press(pointerType: string) {
  const handler = MouseOrPenSensor.activators[0]!.handler
  const event = {
    nativeEvent: { pointerType, isPrimary: true, button: 0 },
  } as unknown as ReactPointerEvent
  return handler(event, {})
}

describe('MouseOrPenSensor', () => {
  it('leaves a finger to the touch sensor', () => {
    expect(press('touch')).toBe(false)
  })

  it('takes the mouse and the pen', () => {
    expect(press('mouse')).toBe(true)
    expect(press('pen')).toBe(true)
  })
})
