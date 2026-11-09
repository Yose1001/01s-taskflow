import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/context'
import { errorMessage, fieldErrorMessage } from '../auth/errors'
import { Alert, Button, PasswordField, TextField } from '../components/forms'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Errors = Partial<Record<'email' | 'password', string>>

export function LoginPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('auth.loginTitle'))
  const { login, sessionExpired } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  const mutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      login(credentials.email, credentials.password),
    onError: (error) => {
      // Field problems reported by the server are shown next to the fields.
      if (error instanceof ApiError && error.code === 'validation_failed') {
        setErrors({
          ...(error.fields.email && { email: error.fields.email }),
          ...(error.fields.password && { password: error.fields.password }),
        })
      }
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Errors = {}
    const trimmed = email.trim()
    if (!trimmed) next.email = 'required'
    else if (!EMAIL_PATTERN.test(trimmed)) next.email = 'invalid_email'
    if (!password) next.password = 'required'
    setErrors(next)
    if (next.email || next.password) {
      document.getElementById(next.email ? 'login-email' : 'login-password')?.focus()
      return
    }
    mutation.mutate({ email: trimmed, password })
  }

  const serverError = mutation.error
  const showBanner =
    serverError && !(serverError instanceof ApiError && serverError.code === 'validation_failed')

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-bold">{t('auth.loginTitle')}</h1>
      <p className="mt-1 text-muted">{t('auth.loginIntro')}</p>

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5"
      >
        {sessionExpired && <Alert tone="info">{t('auth.sessionExpired')}</Alert>}
        {showBanner && <Alert>{errorMessage(t, serverError)}</Alert>}

        <TextField
          id="login-email"
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email ? fieldErrorMessage(t, errors.email) : undefined}
        />
        <PasswordField
          id="login-password"
          label={t('auth.password')}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password ? fieldErrorMessage(t, errors.password) : undefined}
        />
        <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
          {mutation.isPending ? t('auth.loggingIn') : t('auth.loginButton')}
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="font-medium text-primary underline">
          {t('nav.signup')}
        </Link>
      </p>
    </div>
  )
}
