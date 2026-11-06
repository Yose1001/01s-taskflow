import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './forms'

/** Shown while data is loading. Announced to screen readers. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true" className="h-20 animate-pulse rounded-2xl bg-surface-2" />
      ))}
    </div>
  )
}

/** Shown when loading failed, with a way to try again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="rounded-2xl bg-danger-bg p-5 text-danger-fg">
      <p>{message}</p>
      <div className="mt-3">
        <Button type="button" variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    </div>
  )
}

/** Shown when there is nothing to list. */
export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {hint && <p className="mt-1 text-muted">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
