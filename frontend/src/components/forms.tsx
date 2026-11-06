import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { useTranslation } from 'react-i18next'

const INPUT =
  'w-full rounded-xl border bg-surface px-3 py-2 text-text placeholder:text-muted focus:border-primary'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  id: string
  label: string
  /** Error text for this field (already translated). Marks the field invalid for screen readers. */
  error?: string | undefined
  hint?: string
}

function describedBy(id: string, error?: string, hint?: string) {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined
  )
}

function Frame({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string | undefined
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger-fg">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextField({ id, label, error, hint, ...input }: FieldProps) {
  return (
    <Frame id={id} label={label} error={error} hint={hint}>
      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${INPUT} ${error ? 'border-danger-fg' : 'border-border'}`}
      />
    </Frame>
  )
}

export function TextAreaField({
  id,
  label,
  error,
  hint,
  ...input
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> & {
  id: string
  label: string
  error?: string | undefined
  hint?: string | undefined
}) {
  return (
    <Frame id={id} label={label} error={error} hint={hint}>
      <textarea
        rows={4}
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${INPUT} ${error ? 'border-danger-fg' : 'border-border'}`}
      />
    </Frame>
  )
}

export function SelectField({
  id,
  label,
  error,
  hint,
  children,
  ...select
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  id: string
  label: string
  error?: string | undefined
  hint?: string | undefined
}) {
  return (
    <Frame id={id} label={label} error={error} hint={hint}>
      <select
        {...select}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${INPUT} ${error ? 'border-danger-fg' : 'border-border'}`}
      >
        {children}
      </select>
    </Frame>
  )
}

/** A password box with a Show/Hide button. */
export function PasswordField({ id, label, error, hint, ...input }: Omit<FieldProps, 'type'>) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <Frame id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <input
          {...input}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={`${INPUT} pr-20 ${error ? 'border-danger-fg' : 'border-border'}`}
        />
        <button
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-1 my-1 rounded-lg px-3 text-sm font-medium text-primary-fg hover:bg-primary-bg"
        >
          {visible ? t('auth.hidePassword') : t('auth.showPassword')}
        </button>
      </div>
    </Frame>
  )
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: { variant?: 'primary' | 'secondary' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const style =
    variant === 'primary'
      ? 'bg-primary text-on-primary hover:opacity-90'
      : 'border border-border bg-surface-2 text-text hover:bg-primary-bg'
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${style}`}
    >
      {children}
    </button>
  )
}

export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'info'
  children: ReactNode
}) {
  const style = tone === 'danger' ? 'bg-danger-bg text-danger-fg' : 'bg-sky-bg text-sky-fg'
  return (
    <p role="alert" className={`rounded-xl px-3 py-2 text-sm ${style}`}>
      {children}
    </p>
  )
}
