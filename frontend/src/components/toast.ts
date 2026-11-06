import { createContext, useContext } from 'react'

export interface ToastInput {
  message: string
  /** An optional button, such as "Undo". */
  actionLabel?: string
  onAction?: () => void
}

export interface ToastContextValue {
  show: (toast: ToastInput) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
