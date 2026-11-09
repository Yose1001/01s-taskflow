import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { fieldErrorMessage } from '../../auth/errors'
import { Button, TextAreaField } from '../../components/forms'
import { Modal } from '../../components/Modal'
import { holdReasonError } from './boardLogic'

/** Asks why a task is being put on hold, after it was dropped on that column. Cancel leaves it where it was. */
export function HoldReasonDialog({
  taskTitle,
  onCancel,
  onConfirm,
}: {
  taskTitle: string
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const code = holdReasonError(reason)
    if (code) {
      setError(code)
      document.getElementById('hold-reason')?.focus()
      return
    }
    onConfirm(reason.trim())
  }

  return (
    <Modal title={t('tasks.holdTitle', { title: taskTitle })} onClose={onCancel}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextAreaField
          id="hold-reason"
          label={t('tasks.holdLabel')}
          hint={t('tasks.holdHint')}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
            setError(null)
          }}
          error={error ? fieldErrorMessage(t, error) : undefined}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="soft" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit">{t('tasks.holdConfirm')}</Button>
        </div>
      </form>
    </Modal>
  )
}
