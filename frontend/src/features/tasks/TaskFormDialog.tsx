import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import type { TaskInput, TaskPatch } from '../../api/tasks'
import type { Member, Subtask, Task, TaskPriority, TaskStatus } from '../../api/types'
import { errorMessage, fieldErrorMessage } from '../../auth/errors'
import { DatePicker } from '../../components/DatePicker'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../../components/forms'
import { Modal } from '../../components/Modal'
import { AssigneePicker } from './AssigneePicker'
import { PRIORITIES, STATUSES, holdReasonError } from './boardLogic'
import { useCreateTask, useSubtasks, useUpdateTask } from './hooks'
import { SubtaskList } from './SubtaskList'

const MAX_TITLE = 200
const MAX_DESCRIPTION = 5000
const MAX_SUBTASKS = 100

type FieldName =
  | 'title'
  | 'description'
  | 'assigneeIds'
  | 'subtasks'
  | 'startDate'
  | 'dueDate'
  | 'priority'
  | 'status'
  | 'holdReason'
type Errors = Partial<Record<FieldName, string>>

// Field id in the form, in the order they appear (so the first mistake gets the focus).
const FIELD_IDS: Record<FieldName, string> = {
  title: 'task-title',
  description: 'task-description',
  subtasks: 'task-subtask-new',
  priority: 'task-priority',
  status: 'task-status',
  holdReason: 'task-hold-reason',
  startDate: 'task-start',
  dueDate: 'task-due',
  assigneeIds: 'task-assignee',
}
const FIELD_ORDER: FieldName[] = [
  'title',
  'description',
  'subtasks',
  'priority',
  'status',
  'holdReason',
  'startDate',
  'dueDate',
  'assigneeIds',
]

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

interface Props {
  projectId: string
  members: Member[]
  /** Present when editing; absent when creating. */
  task?: Task
  /** Editing only: the task's subtasks as they are now, which change while the dialog is open. */
  subtasks?: Subtask[]
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
  subtasks: savedSubtasks = [],
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
  const [assigneeIds, setAssigneeIds] = useState(task?.assigneeIds ?? [])
  const [startDate, setStartDate] = useState(task?.startDate ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? initialStatus)
  const [holdReason, setHoldReason] = useState(task?.holdReason ?? '')
  const [errors, setErrors] = useState<Errors>({})
  // While creating, the lines live here and go to the server with the task.
  const [newLines, setNewLines] = useState<Subtask[]>([])
  const [nextLine, setNextLine] = useState(0)
  const [subtaskDraft, setSubtaskDraft] = useState('')

  const create = useCreateTask(projectId)
  const update = useUpdateTask(projectId)
  const subtasks = useSubtasks(projectId, task?.id ?? '')
  const mutation = editing ? update : create
  const pending = mutation.isPending || subtasks.add.isPending
  const lines = editing ? savedSubtasks : newLines
  const subtaskFailure = subtasks.add.error ?? subtasks.update.error ?? subtasks.remove.error

  function showErrors(next: Errors) {
    setErrors(next)
    const first = FIELD_ORDER.find((name) => next[name])
    if (first) document.getElementById(FIELD_IDS[first])?.focus()
  }

  /** Adds what is in the box as a new line. On a saved task, andThen runs once the server has it. */
  function addLine(andThen?: () => void) {
    const title = subtaskDraft.trim()
    if (title === '') return
    if (lines.length >= MAX_SUBTASKS) return showErrors({ subtasks: 'too_many_subtasks' })
    setErrors({})
    if (!editing) {
      setNewLines([...newLines, { id: String(nextLine), title, done: false }])
      setNextLine(nextLine + 1)
      setSubtaskDraft('')
      return
    }
    subtasks.add.mutate(title, {
      onSuccess: () => {
        setSubtaskDraft('')
        andThen?.()
      },
    })
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
    const onHold = status === 'on_hold'
    const holdError = onHold ? holdReasonError(holdReason) : null
    if (holdError) next.holdReason = holdError
    const toCreate = [...newLines.map((line) => line.title)]
    if (!editing && subtaskDraft.trim() !== '') toCreate.push(subtaskDraft.trim()) // left in the box: not lost
    if (toCreate.length > MAX_SUBTASKS) next.subtasks = 'too_many_subtasks'
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

    const start = startDate === '' ? null : startDate
    const due = dueDate === '' ? null : dueDate

    if (!editing) {
      const input: TaskInput = { title: trimmed, description, priority, status }
      if (onHold) input.holdReason = holdReason.trim()
      if (assigneeIds.length > 0) input.assigneeIds = assigneeIds
      if (start !== null) input.startDate = start
      if (due !== null) input.dueDate = due
      if (toCreate.length > 0) input.subtasks = toCreate
      create.mutate(input, handlers)
      return
    }

    // A line left in the box is saved first, so that it is not lost when the dialog closes.
    if (subtaskDraft.trim() !== '') return addLine(saveChanges)
    saveChanges()

    function saveChanges() {
      if (!task) return
      // Send only what changed, so someone else's edits to other fields are not overwritten.
      const patch: TaskPatch = {}
      if (trimmed !== task.title) patch.title = trimmed
      if (description !== task.description) patch.description = description
      if (priority !== task.priority) patch.priority = priority
      if (!sameIds(assigneeIds, task.assigneeIds)) patch.assigneeIds = assigneeIds
      if (start !== task.startDate) patch.startDate = start
      if (due !== task.dueDate) patch.dueDate = due
      const moved = status !== task.status
      // Staying on hold, the reason is an ordinary field. Going on hold, it travels with the move.
      if (onHold && !moved && holdReason.trim() !== task.holdReason)
        patch.holdReason = holdReason.trim()
      if (Object.keys(patch).length === 0 && !moved) return onClose() // nothing to save
      update.mutate(
        {
          task,
          patch,
          ...(moved && { status }),
          ...(moved && onHold && { holdReason: holdReason.trim() }),
        },
        handlers,
      )
    }
  }

  const serverError = mutation.error
  const showBanner =
    serverError && !(serverError instanceof ApiError && serverError.code === 'validation_failed')
  const fieldMessage = (name: FieldName) =>
    errors[name] ? fieldErrorMessage(t, errors[name]) : undefined

  function subtaskMessage() {
    if (errors.subtasks) return fieldMessage('subtasks')
    if (!subtaskFailure) return undefined
    const code = subtaskFailure instanceof ApiError ? subtaskFailure.fields?.title : undefined
    return code ? fieldErrorMessage(t, code) : t('tasks.subtaskSaveFailed')
  }

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
        <SubtaskList
          inputId={FIELD_IDS.subtasks}
          items={lines}
          tickable={editing}
          hint={editing ? t('tasks.subtasksHint') : undefined}
          draft={subtaskDraft}
          onDraftChange={setSubtaskDraft}
          onAdd={() => addLine()}
          onToggle={(item) => subtasks.update.mutate({ id: item.id, patch: { done: !item.done } })}
          onRename={(item, newTitle) => {
            if (editing) subtasks.update.mutate({ id: item.id, patch: { title: newTitle } })
            else
              setNewLines(
                newLines.map((line) => (line.id === item.id ? { ...line, title: newTitle } : line)),
              )
          }}
          onRemove={(item) => {
            if (editing) subtasks.remove.mutate(item.id)
            else setNewLines(newLines.filter((line) => line.id !== item.id))
          }}
          error={subtaskMessage()}
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
          {status === 'on_hold' && (
            <div className="sm:col-span-2">
              <TextAreaField
                id={FIELD_IDS.holdReason}
                label={t('tasks.holdLabel')}
                hint={t('tasks.holdHint')}
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                error={fieldMessage('holdReason')}
              />
            </div>
          )}
          {/* Each calendar stops at the other date, so the two can never end up in the wrong order. */}
          <DatePicker
            id={FIELD_IDS.startDate}
            label={t('tasks.startLabel')}
            value={startDate}
            onChange={setStartDate}
            max={dueDate || undefined}
            error={fieldMessage('startDate')}
          />
          <DatePicker
            id={FIELD_IDS.dueDate}
            label={t('tasks.dueLabel')}
            value={dueDate}
            onChange={setDueDate}
            min={startDate || undefined}
            error={fieldMessage('dueDate')}
          />
        </div>
        <AssigneePicker
          id={FIELD_IDS.assigneeIds}
          members={members}
          selected={assigneeIds}
          onChange={setAssigneeIds}
          error={fieldMessage('assigneeIds')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div>
            {editing && onDelete && (
              <Button
                type="button"
                variant="danger-outline"
                onClick={() => onDelete(task)}
                disabled={pending}
              >
                {t('tasks.delete')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="soft" onClick={onClose} disabled={pending}>
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
