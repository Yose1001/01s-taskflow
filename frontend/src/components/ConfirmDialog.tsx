import { useTranslation } from 'react-i18next'
import { Alert, Button } from './forms'
import { Modal } from './Modal'

interface Props {
  title: string
  message: string
  confirmLabel: string
  pendingLabel: string
  pending: boolean
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
  error,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  return (
    <Modal title={title} onClose={pending ? () => {} : onCancel}>
      <p className="text-muted">{message}</p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={onConfirm} disabled={pending} aria-busy={pending}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
