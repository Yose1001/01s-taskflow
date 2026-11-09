import { useTranslation } from 'react-i18next'
import { Alert, Button } from './forms'
import { Icon, type IconName } from './Icon'
import { Modal } from './Modal'

interface Props {
  title: string
  message: string
  confirmLabel: string
  pendingLabel: string
  pending: boolean
  /** Trash by default. Use another icon when the action does not put anything in the trash. */
  icon?: IconName
  /** Error text to show inside the dialog when the action failed. */
  error?: string | undefined
  onConfirm: () => void
  onCancel: () => void
}

/** "Are you sure?" for actions with consequences. Cancel comes first so it gets the focus (the safe choice). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  pendingLabel,
  pending,
  icon = 'trash',
  error,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  return (
    <Modal
      title={title}
      icon={
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-bg text-danger-fg">
          <Icon name={icon} size={20} />
        </span>
      }
      onClose={pending ? () => {} : onCancel}
    >
      <p className="break-words text-muted">{message}</p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={onConfirm}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
