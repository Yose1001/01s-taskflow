import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import type { TaskInput, TaskPatch } from '../../api/tasks'
import type { Member, Task, TaskPriority, TaskStatus } from '../../api/types'
import { errorMessage, fieldErrorMessage } from '../../auth/errors'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../../components/forms'
import { Modal } from '../../components/Modal'
import { PRIORITIES, STATUSES } from './boardLogic'
import { useCreateTask, useUpdateTask } from './hooks'

const MAX_TITLE = 200
const MAX_DESCRIPTION = 5000

type FieldName = 'title' | 'description' | 'assigneeId' | 'dueDate' | 'priority' | 'status'
type Errors = Partial<Record<FieldName, string>>

// Field id in the form, in the order they appear (so the first mistake gets the focus).
const FIELD_IDS: Record<FieldName, string> = {
  title: 'task-title',
  description: 'task-description',
  priority: 'task-priority',
  assigneeId: 'task-assignee',
  dueDate: 'task-due',
  status: 'task-status',
}
const FIELD_ORDER: FieldName[] = [
  'title',
  'description',
  'priority',
  'assigneeId',
  'dueDate',
  'status',
]

interface Props {
  projectId: string
  members: Member[]
  /** Present when editing; absent when creating. */
  task?: Task
  /** The column a new task starts in. */
  initialStatus?: TaskStatus
  onClose: () => void
  onSaved: () => void
  /** Editing only: the person asked to delete this task. */
  onDelete?: (task: Task) => void
}

/** The create / edit form for a task, in a dialog. */
export function TaskFormDialog({
  projectId,
  members,
  task,
  initialStatus = 'todo',
  onClose,
  onSaved,
  onDelete,
}: Props) {
  const { t } = useTranslation()
  const editing = task !== undefined
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? initialStatus)
  const [errors, setErrors] = useState<Errors>({})

  const create = useCreateTask(projectId)
  const update = useUpdateTask(projectId)
  const mutation = editing ? update : create
  const pending = mutation.isPending

  function showErrors(next: Errors) {
    setErrors(next)
    const first = FIELD_ORDER.find((name) => next[name])
    if (first) document.getElementById(FIELD_IDS[first])?.focus()
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    const next: Errors = {}
    const length = Array.from(trimmed).length
    if (length < 1) next.title = 'required'
    else if (length > MAX_TITLE) next.title = 'invalid_title'
    if (Array.from(description).length > MAX_DESCRIPTION)
      next.description = 'task_description_too_long'
    if (dueDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) next.dueDate = 'invalid_date'
    if (Object.keys(next).length > 0) return showErrors(next)
    setErrors({})

    const handlers = {
      onSuccess: () => onSaved(),
      onError: (error: unknown) => {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          const fromServer: Errors = {}
          for (const name of FIELD_ORDER) {
            const code = error.fields[name]
            if (code)
              fromServer[name] =
                code === 'description_too_long' ? 'task_description_too_long' : code
          }
          showErrors(fromServer)
        }
      },
    }

    const assignee = assigneeId === '' ? null : assigneeId
    const due = dueDate === '' ? null : dueDate

    if (!editing) {
      const input: TaskInput = { title: trimmed, description, priority, status }
      if (assignee !== null) input.assigneeId = assignee
      if (due !== null) input.dueDate = due
      create.mutate(input, handlers)
      return
    }

    // Editing: send only what changed, so someone else's edits to other fields are not overwritten.
    const patch: TaskPatch = {}
    if (trimmed !== task.title) patch.title = trimmed
    if (description !== task.description) patch.description = description
    if (priority !== task.priority) patch.priority = priority
    if (assignee !== task.assigneeId) patch.assigneeId = assignee
    if (due !== task.dueDate) patch.dueDate = due
    const moved = status !== task.status
    if (Object.keys(patch).length === 0 && !moved) return onClose() // nothing to save
    update.mutate({ task, patch, ...(moved && { status }) }, handlers)
  }

  const serverError = mutation.error
  const showBanner =
    serverError && !(serverError instanceof ApiError && serverError.code === 'validation_failed')
  const fieldMessage = (name: FieldName) =>
    errors[name] ? fieldErrorMessage(t, errors[name]) : undefined

  return (
    <Modal
      title={editing ? t('tasks.editTitle') : t('tasks.createTitle')}
      onClose={pending ? () => {} : onClose}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {showBanner && <Alert>{errorMessage(t, serverError)}</Alert>}
        <TextField
          id={FIELD_IDS.title}
          label={t('tasks.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={fieldMessage('title')}
          autoComplete="off"
        />
        <TextAreaField
          id={FIELD_IDS.description}
          label={t('tasks.descriptionLabel')}
          hint={t('tasks.descriptionHint')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={fieldMessage('description')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id={FIELD_IDS.priority}
            label={t('tasks.priorityLabel')}
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            error={fieldMessage('priority')}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={FIELD_IDS.status}
            label={t('tasks.statusLabel')}
            hint={editing ? t('tasks.statusMoveHint') : undefined}
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            error={fieldMessage('status')}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={FIELD_IDS.assigneeId}
            label={t('tasks.assigneeLabel')}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            error={fieldMessage('assigneeId')}
          >
            <option value="">{t('tasks.unassigned')}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </SelectField>
          <TextField
            id={FIELD_IDS.dueDate}
            type="date"
            label={t('tasks.dueLabel')}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            error={fieldMessage('dueDate')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div>
            {editing && onDelete && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onDelete(task)}
                disabled={pending}
              >
                {t('tasks.delete')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending
                ? editing
                  ? t('tasks.saving')
                  : t('tasks.creating')
                : editing
                  ? t('tasks.save')
                  : t('tasks.create')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
