import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from './Icon'

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

/** The frame of a one-line control: the label exists for screen readers, an icon takes its place on screen. */
function CompactFrame({
  id,
  label,
  icon,
  className,
  children,
}: {
  id: string
  label: string
  icon: IconName
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <div className={`relative min-w-0 ${className ?? ''}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
        <Icon name={icon} />
      </span>
      {children}
    </div>
  )
}

export function CompactTextField({
  id,
  label,
  icon,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string
  label: string
  icon: IconName
}) {
  return (
    <CompactFrame id={id} label={label} icon={icon} className={className}>
      <input {...input} id={id} className={`${INPUT} border-border pl-9`} />
    </CompactFrame>
  )
}

export function CompactSelectField({
  id,
  label,
  icon,
  className,
  children,
  ...select
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  id: string
  label: string
  icon: IconName
}) {
  return (
    <CompactFrame id={id} label={label} icon={icon} className={className}>
      <select {...select} id={id} aria-label={label} className={`${INPUT} border-border pl-9`}>
        {children}
      </select>
    </CompactFrame>
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

const BUTTON_STYLES = {
  // A page has one primary button. Everything else is soft or ghost.
  primary: 'bg-primary text-on-primary hover:opacity-90',
  soft: 'border border-border bg-surface-2 text-text hover:bg-primary-bg',
  ghost: 'text-text hover:bg-primary-bg',
  // Only for the confirm button of a delete dialog.
  danger: 'bg-danger text-on-danger hover:opacity-90',
  'danger-outline': 'border border-danger text-danger hover:bg-danger-bg hover:text-danger-fg',
  'danger-soft': 'bg-danger-bg text-danger-fg hover:opacity-90',
}

export type ButtonVariant = keyof typeof BUTTON_STYLES

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: { variant?: ButtonVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_STYLES[variant]} ${className}`}
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
