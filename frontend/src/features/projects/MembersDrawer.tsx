import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import type { Member } from '../../api/types'
import { useAuth } from '../../auth/context'
import { errorMessage, fieldErrorMessage } from '../../auth/errors'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Alert, Button, TextField } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { Menu } from '../../components/Menu'
import { Modal } from '../../components/Modal'
import { RoleBadge } from '../../components/RoleBadge'
import { ErrorState, LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { formatDate } from '../../lib/format'
import { useInviteMember, useMembers, useRemoveMember } from './hooks'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Who is in the project, opened from the project header: a panel from the right on wide screens and a
 * sheet from the bottom on phones. The owner can invite and remove people; members see the list only.
 */
export function MembersDrawer({
  projectId,
  isOwner,
  onClose,
}: {
  projectId: string
  isOwner: boolean
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const { user } = useAuth()
  const members = useMembers(projectId)
  const invite = useInviteMember(projectId)
  const remove = useRemoveMember(projectId)

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | undefined>()
  const [toRemove, setToRemove] = useState<Member | null>(null)

  // Removing someone takes away the row that had the focus. Keep the focus inside the panel.
  const count = members.data?.length
  useEffect(() => {
    if (document.activeElement === document.body) document.getElementById('invite-email')?.focus()
  }, [count])

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
    <>
      <Modal
        title={t('members.title')}
        onClose={onClose}
        variant="drawer"
        closeLabel={t('common.close')}
      >
        {members.isPending ? (
          <LoadingState label={t('common.loading')} />
        ) : members.isError ? (
          <ErrorState message={t('members.loadError')} onRetry={() => void members.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {members.data.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-3">
                <Avatar id={m.userId} name={m.displayName} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">
                    {m.displayName}
                    {m.userId === user?.id && (
                      <span className="font-normal text-muted"> {t('members.you')}</span>
                    )}
                  </p>
                  <p className="break-words text-sm text-muted">
                    {m.email} ·{' '}
                    {t('members.joined', { date: formatDate(m.joinedAt, i18n.language) })}
                  </p>
                  <div className="mt-1">
                    <RoleBadge role={m.role} />
                  </div>
                </div>
                {isOwner && m.role !== 'owner' && (
                  <Menu
                    label={t('members.actionsFor', { name: m.displayName })}
                    trigger={<Icon name="more" size={20} />}
                    triggerClassName="grid h-10 w-10 place-items-center rounded-xl text-text hover:bg-primary-bg"
                    items={[
                      {
                        key: 'remove',
                        label: t('members.removeFromProject'),
                        ariaLabel: `${t('members.remove')}: ${m.displayName}`,
                        tone: 'danger-soft',
                        onSelect: () => setToRemove(m),
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner ? (
          <form
            onSubmit={onInvite}
            noValidate
            className="mt-4 space-y-3 border-t border-border pt-4"
          >
            <h3 className="font-semibold">{t('members.invite')}</h3>
            <p className="text-sm text-muted">{t('members.inviteHelp')}</p>
            {inviteBanner && <Alert>{inviteBanner}</Alert>}
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
            <Button
              type="submit"
              variant="soft"
              disabled={invite.isPending}
              aria-busy={invite.isPending}
            >
              {invite.isPending ? t('members.inviting') : t('members.inviteButton')}
            </Button>
          </form>
        ) : (
          <p className="mt-4 border-t border-border pt-4 text-sm text-muted">
            {t('members.ownerOnly')}
          </p>
        )}
      </Modal>

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
    </>
  )
}
