import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import type { Member } from '../../api/types'
import { errorMessage, fieldErrorMessage } from '../../auth/errors'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Alert, Button, TextField } from '../../components/forms'
import { RoleBadge } from '../../components/RoleBadge'
import { ErrorState, LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { formatDate } from '../../lib/format'
import { useInviteMember, useMembers, useRemoveMember } from './hooks'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The member list, with invite and remove for the project's owner. Members see the list only. */
export function MembersSection({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const members = useMembers(projectId)
  const invite = useInviteMember(projectId)
  const remove = useRemoveMember(projectId)

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | undefined>()
  const [toRemove, setToRemove] = useState<Member | null>(null)

  function onInvite(event: FormEvent) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return fail('required')
    if (!EMAIL_PATTERN.test(trimmed)) return fail('invalid_email')
    setEmailError(undefined)
    invite.mutate(trimmed, {
      onSuccess: (member) => {
        setEmail('')
        toast.show({ message: t('members.invited', { name: member.displayName }) })
      },
    })
  }

  function fail(code: string) {
    setEmailError(code)
    document.getElementById('invite-email')?.focus()
  }

  // The API says "not found" when no account uses this email: explain it in terms the person understands.
  const inviteError = invite.error
  let inviteMessage: string | undefined
  if (emailError) inviteMessage = fieldErrorMessage(t, emailError)
  else if (inviteError instanceof ApiError && inviteError.code === 'not_found')
    inviteMessage = t('members.noAccount')
  else if (inviteError instanceof ApiError && inviteError.code === 'validation_failed')
    inviteMessage = fieldErrorMessage(t, inviteError.fields.email ?? 'invalid')
  const inviteBanner = inviteError && !inviteMessage ? errorMessage(t, inviteError) : undefined

  return (
    <section
      id="members"
      aria-labelledby="members-title"
      className="scroll-mt-20 rounded-2xl border border-border bg-surface p-5"
    >
      <h2 id="members-title" className="text-lg font-semibold">
        {t('members.title')}
      </h2>

      {members.isPending ? (
        <div className="mt-3">
          <LoadingState label={t('common.loading')} />
        </div>
      ) : members.isError ? (
        <div className="mt-3">
          <ErrorState message={t('members.loadError')} onRetry={() => void members.refetch()} />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {members.data.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.displayName}</p>
                <p className="truncate text-sm text-muted">
                  {m.email} · {t('members.joined', { date: formatDate(m.joinedAt, i18n.language) })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <RoleBadge role={m.role} />
                {isOwner && m.role !== 'owner' && (
                  <Button
                    type="button"
                    variant="danger-soft"
                    onClick={() => setToRemove(m)}
                    aria-label={`${t('members.remove')}: ${m.displayName}`}
                  >
                    {t('members.remove')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        <form onSubmit={onInvite} noValidate className="mt-5 space-y-3 border-t border-border pt-5">
          <h3 className="font-medium">{t('members.invite')}</h3>
          {inviteBanner && <Alert>{inviteBanner}</Alert>}
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-60 flex-1">
              <TextField
                id="invite-email"
                label={t('members.inviteEmail')}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailError(undefined)
                  invite.reset()
                }}
                error={inviteMessage}
              />
            </div>
            <div className="pt-6">
              <Button
                type="submit"
                variant="soft"
                disabled={invite.isPending}
                aria-busy={invite.isPending}
              >
                {invite.isPending ? t('members.inviting') : t('members.inviteButton')}
              </Button>
            </div>
          </div>
        </form>
      )}

      {toRemove && (
        <ConfirmDialog
          icon="users" // nothing goes to the trash here: the person simply loses access
          title={t('members.removeTitle', { name: toRemove.displayName })}
          message={t('members.removeMessage', { name: toRemove.displayName })}
          confirmLabel={t('members.removeConfirm')}
          pendingLabel={t('members.removing')}
          pending={remove.isPending}
          error={remove.error ? errorMessage(t, remove.error) : undefined}
          onCancel={() => {
            remove.reset()
            setToRemove(null)
          }}
          onConfirm={() =>
            remove.mutate(toRemove.userId, {
              onSuccess: () => {
                toast.show({ message: t('members.removed', { name: toRemove.displayName }) })
                setToRemove(null)
              },
            })
          }
        />
      )}
    </section>
  )
}
