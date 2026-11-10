import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import type { EventInput, EventPatch } from '../../api/calendar'
import { REMIND_DAYS, type CalendarEvent, type RemindDay } from '../../api/types'
import { errorMessage, fieldErrorMessage } from '../../auth/errors'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DatePicker } from '../../components/DatePicker'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../../components/forms'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/toast'
import { useCreateEvent, useDeleteEvent, useProjectChoices, useUpdateEvent } from './hooks'

const MAX_TITLE = 120
const MAX_NOTE = 1000
/** A new day reminds on the day and the day before, unless the person changes it. */
const DEFAULT_REMIND: RemindDay[] = [0, 1]

type FieldName = 'title' | 'day' | 'projectId' | 'note' | 'remindDays'
type Errors = Partial<Record<FieldName, string>>

// Field ids in the order they appear, so the first mistake gets the focus.
const FIELD_IDS: Record<FieldName, string> = {
  title: 'event-title',
  day: 'event-day',
  projectId: 'event-project',
  note: 'event-note',
  remindDays: 'event-remind-0',
}
const FIELD_ORDER: FieldName[] = ['title', 'day', 'projectId', 'note', 'remindDays']

const sameDays = (a: RemindDay[], b: RemindDay[]) =>
  a.length === b.length && a.every((d) => b.includes(d))

/** Adds an important day, or changes one the person may change. */
export function EventDialog({
  event,
  day: initialDay,
  onClose,
}: {
  /** Present when editing; absent when adding. */
  event?: CalendarEvent | undefined
  /** The day a new one starts on. */
  day: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const editing = event !== undefined
  const [title, setTitle] = useState(event?.title ?? '')
  const [note, setNote] = useState(event?.note ?? '')
  const [day, setDay] = useState(event?.day ?? initialDay)
  const [projectId, setProjectId] = useState('')
  const [remindDays, setRemindDays] = useState<RemindDay[]>(event?.remindDays ?? DEFAULT_REMIND)
  const [errors, setErrors] = useState<Errors>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  const projects = useProjectChoices()
  const create = useCreateEvent()
  const update = useUpdateEvent()
  const remove = useDeleteEvent()
  const mutation = editing ? update : create
  const pending = mutation.isPending

  function showErrors(next: Errors) {
    setErrors(next)
    const first = FIELD_ORDER.find((name) => next[name])
    if (first) document.getElementById(FIELD_IDS[first])?.focus()
  }

  function toggleDay(value: RemindDay) {
    setRemindDays((now) =>
      now.includes(value) ? now.filter((d) => d !== value) : [...now, value].sort((a, b) => a - b),
    )
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    const next: Errors = {}
    const length = Array.from(trimmed).length
    if (length < 1) next.title = 'required'
    else if (length > MAX_TITLE) next.title = 'too_long'
    if (Array.from(note.trim()).length > MAX_NOTE) next.note = 'too_long'
    if (day === '') next.day = 'required'
    if (Object.keys(next).length > 0) return showErrors(next)
    setErrors({})

    const handlers = {
      onSuccess: () => {
        toast.show({
          message: t(editing ? 'calendar.saved' : 'calendar.added', { title: trimmed }),
        })
        onClose()
      },
      onError: (error: unknown) => {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          const fromServer: Errors = {}
          for (const name of FIELD_ORDER)
            if (error.fields[name]) fromServer[name] = error.fields[name]
          showErrors(fromServer)
        }
      },
    }

    if (!event) {
      const input: EventInput = { title: trimmed, note: note.trim(), day, remindDays }
      if (projectId) input.projectId = projectId
      create.mutate(input, handlers)
      return
    }
    // Send only what changed, so someone else's change to another field is not undone.
    const patch: EventPatch = {}
    if (trimmed !== event.title) patch.title = trimmed
    if (note.trim() !== event.note) patch.note = note.trim()
    if (day !== event.day) patch.day = day
    if (!sameDays(remindDays, event.remindDays)) patch.remindDays = remindDays
    if (Object.keys(patch).length === 0) return onClose()
    update.mutate({ id: event.id, patch }, handlers)
  }

  const serverError = mutation.error
  const showBanner =
    serverError && !(serverError instanceof ApiError && serverError.code === 'validation_failed')
  const fieldMessage = (name: FieldName) =>
    errors[name] ? fieldErrorMessage(t, errors[name]) : undefined

  return (
    <>
      <Modal
        title={editing ? t('calendar.editTitle') : t('calendar.addTitle')}
        onClose={pending ? () => {} : onClose}
      >
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {showBanner && <Alert>{errorMessage(t, serverError)}</Alert>}
          <TextField
            id={FIELD_IDS.title}
            label={t('calendar.titleLabel')}
            placeholder={t('calendar.titlePlaceholder')}
            value={title}
            maxLength={MAX_TITLE}
            autoComplete="off"
            onChange={(e) => setTitle(e.target.value)}
            error={fieldMessage('title')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <DatePicker
              id={FIELD_IDS.day}
              label={t('calendar.dayLabel')}
              value={day}
              onChange={setDay}
              error={fieldMessage('day')}
            />
            {editing ? (
              // Where a day belongs is chosen once, when it is added.
              <div>
                <p className="mb-1 text-sm font-medium">{t('calendar.belongsLabel')}</p>
                <p className="py-2 text-muted">{event.projectName ?? t('calendar.personal')}</p>
              </div>
            ) : (
              <SelectField
                id={FIELD_IDS.projectId}
                label={t('calendar.belongsLabel')}
                hint={t('calendar.belongsHint')}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                error={fieldMessage('projectId')}
              >
                <option value="">{t('calendar.personal')}</option>
                {(projects.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          <TextAreaField
            id={FIELD_IDS.note}
            label={t('calendar.noteLabel')}
            value={note}
            rows={2}
            maxRows={6}
            onChange={(e) => setNote(e.target.value)}
            error={fieldMessage('note')}
          />
          <fieldset className="min-w-0">
            <legend className="mb-1 text-sm font-medium">{t('calendar.remindLabel')}</legend>
            <p className="mb-2 text-sm text-muted">{t('calendar.remindHint')}</p>
            <div className="flex flex-wrap gap-2">
              {REMIND_DAYS.map((value) => {
                const checked = remindDays.includes(value)
                return (
                  <label
                    key={value}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
                      checked
                        ? 'border-primary bg-primary-bg text-primary-fg'
                        : 'border-border text-text hover:bg-primary-bg'
                    }`}
                  >
                    <input
                      id={`event-remind-${value}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDay(value)}
                      className="h-4 w-4 accent-primary"
                    />
                    {t(`calendar.remind_${value}`)}
                  </label>
                )
              })}
            </div>
            {fieldMessage('remindDays') && (
              <p className="mt-1 text-sm font-medium text-danger-fg">
                {fieldMessage('remindDays')}
              </p>
            )}
          </fieldset>
          <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-6 py-4">
            <div>
              {editing && (
                <Button
                  type="button"
                  variant="danger-outline"
                  onClick={() => setConfirmDelete(true)}
                  disabled={pending}
                >
                  {t('calendar.delete')}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="soft" onClick={onClose} disabled={pending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? t('calendar.saving') : editing ? t('calendar.save') : t('calendar.add')}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
      {confirmDelete && event && (
        <ConfirmDialog
          title={t('calendar.deleteTitle', { title: event.title })}
          message={t('calendar.deleteMessage')}
          confirmLabel={t('calendar.deleteConfirm')}
          pendingLabel={t('calendar.deleting')}
          pending={remove.isPending}
          error={remove.error ? errorMessage(t, remove.error) : undefined}
          onCancel={() => {
            remove.reset()
            setConfirmDelete(false)
          }}
          onConfirm={() =>
            remove.mutate(event.id, {
              onSuccess: () => {
                toast.show({ message: t('calendar.deleted', { title: event.title }) })
                onClose()
              },
            })
          }
        />
      )}
    </>
  )
}
