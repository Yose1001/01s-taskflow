import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/context'
import { Icon } from './Icon'
import { ToastContext, type ToastInput } from './toast'

interface Item extends ToastInput {
  id: number
}

const VISIBLE_MS = 8000

/** Short messages at the bottom of the screen. Announced politely to screen readers; disappear by themselves. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<Item[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((list) => list.filter((i) => i.id !== id))
  }, [])

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setItems((list) => [...list.slice(-2), { ...toast, id }]) // at most 3 at a time
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), VISIBLE_MS),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const current = timers.current
    return () => current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  // Messages belong to the person who triggered them: when the signed-in person changes (or logs out),
  // they are removed, so the next person never reads someone else's "member removed" or "Undo".
  // (Adjusting state while rendering is React's way to reset state when something it depends on changes.)
  const userId = useAuth().user?.id ?? null
  const [ownerId, setOwnerId] = useState(userId)
  if (ownerId !== userId) {
    setOwnerId(userId)
    setItems([])
  }

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        // On phones the messages sit above the floating "New task" button.
        // Above dialogs and the members panel (z-50), which would otherwise cover the message.
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 max-sm:bottom-20"
      >
        {items.map((item) => {
          // Only "moved to the trash" messages offer Undo. They stand out with reversed colors.
          const undoable = Boolean(item.actionLabel && item.onAction)
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex max-w-full items-center gap-3 px-4 py-3 text-sm shadow-lg sm:max-w-md ${
                undoable
                  ? 'rounded-[1.75rem] bg-text text-bg'
                  : 'rounded-xl border border-border bg-surface'
              }`}
            >
              {undoable && <Icon name="trash" />}
              <span className="min-w-0 break-words">{item.message}</span>
              {undoable && (
                <button
                  type="button"
                  onClick={() => {
                    item.onAction?.()
                    dismiss(item.id)
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-bg px-3 py-1 font-semibold text-text hover:opacity-90"
                >
                  <Icon name="undo" size={14} />
                  {item.actionLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label={t('common.dismiss')}
                className={`shrink-0 ${undoable ? 'hover:opacity-80' : 'text-muted hover:text-text'}`}
              >
                <Icon name="x" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
