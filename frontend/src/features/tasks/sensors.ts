import { PointerSensor, type PointerSensorOptions } from '@dnd-kit/core'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Mouse and pen only. A finger also sends pointer events, and they come first, so a plain PointerSensor
 * would take every touch and TouchSensor (with its delay, so that scrolling never picks up a card) would
 * never get a turn.
 */
export class MouseOrPenSensor extends PointerSensor {
  static override activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: ReactPointerEvent, options: PointerSensorOptions) =>
        event.nativeEvent.pointerType === 'touch'
          ? false
          : PointerSensor.activators[0]!.handler(event, options),
    },
  ]
}
