import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth, type RegisterInput } from '../auth/context'
import { errorMessage, fieldErrorMessage } from '../auth/errors'
import { Alert, Button, PasswordField, TextField } from '../components/forms'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_CHARS = 8
const MAX_PASSWORD_BYTES = 72 // the server's limit: Thai letters take 3 bytes each
const MAX_NAME_CHARS = 80

type Field = 'displayName' | 'email' | 'password'
type Errors = Partial<Record<Field, string>>

const FIELD_IDS: Record<Field, string> = {
  displayName: 'register-name',
  email: 'register-email',
  password: 'register-password',
}
const ORDER: Field[] = ['displayName', 'email', 'password']

export function RegisterPage() {
  const { t } = useTranslation()
  const { register } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  const mutation = useMutation({
    mutationFn: (input: RegisterInput) => register(input),
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'email_taken') setErrors({ email: 'email_taken' })
      else if (error.code === 'validation_failed') {
        const next: Errors = {}
        for (const field of ORDER) if (error.fields[field]) next[field] = error.fields[field]
        setErrors(next)
      }
    },
  })

  function validate(): Errors {
    const next: Errors = {}
    const name = displayName.trim()
    const nameLength = Array.from(name).length
    if (nameLength < 1 || nameLength > MAX_NAME_CHARS)
      next.displayName = nameLength < 1 ? 'required' : 'invalid_display_name'
    const mail = email.trim()
    if (!mail) next.email = 'required'
    else if (!EMAIL_PATTERN.test(mail)) next.email = 'invalid_email'
    if (Array.from(password).length < MIN_PASSWORD_CHARS) next.password = 'password_too_short'
    else if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES)
      next.password = 'password_too_long'
    return next
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next = validate()
    setErrors(next)
    const first = ORDER.find((f) => next[f])
    if (first) {
      document.getElementById(FIELD_IDS[first])?.focus()
      return
    }
    mutation.mutate({ displayName: displayName.trim(), email: email.trim(), password })
  }

  const serverError = mutation.error
  const fieldLevel =
    serverError instanceof ApiError &&
    (serverError.code === 'validation_failed' || serverError.code === 'email_taken')
  const msg = (f: Field) => (errors[f] ? fieldErrorMessage(t, errors[f]) : undefined)

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-bold">{t('auth.signupTitle')}</h1>
      <p className="mt-1 text-muted">{t('auth.signupIntro')}</p>

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5"
      >
        {serverError && !fieldLevel && <Alert>{errorMessage(t, serverError)}</Alert>}

        <TextField
          id={FIELD_IDS.displayName}
          label={t('auth.displayName')}
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={msg('displayName')}
        />
        <TextField
          id={FIELD_IDS.email}
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={msg('email')}
        />
        <PasswordField
          id={FIELD_IDS.password}
          label={t('auth.password')}
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={msg('password')}
        />
        <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
          {mutation.isPending ? t('auth.signingUp') : t('auth.signupButton')}
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-primary underline">
          {t('nav.login')}
        </Link>
      </p>
    </div>
  )
}
