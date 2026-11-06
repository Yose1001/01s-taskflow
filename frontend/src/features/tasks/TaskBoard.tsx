import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { restoreTask } from '../../api/tasks'
import type { Member, Task, TaskStatus } from '../../api/types'
import { useAuth } from '../../auth/context'
import { errorMessage } from '../../auth/errors'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button, SelectField, TextField } from '../../components/forms'
import { ErrorState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../components/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useMembers } from '../projects/hooks'
import {
  NO_FILTERS,
  PRIORITIES,
  STATUSES,
  UNASSIGNED,
  byColumn,
  columnId,
  dropTarget,
  filterTasks,
  hasFilters,
  isPriority,
  type Columns,
  type Filters,
} from './boardLogic'
import { taskKeys, useDeleteTask, useMoveTask, useTasks } from './hooks'
import { SortableTaskCard, TaskCardView } from './TaskCard'
import { TaskFormDialog } from './TaskFormDialog'

/**
 * What is the card dropped on? With a mouse or finger: whatever is under the pointer (a card, or the
 * empty part of a column). With the keyboard there is no pointer, so the nearest corners decide.
 * (Judging by the card's own corners alone picks the wrong column, because cards are wide.)
 */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args)
  return underPointer.length > 0 ? underPointer : closestCorners(args)
}

type Dialog = { kind: 'create'; status: TaskStatus } | { kind: 'edit'; task: Task } | null

const MAX_QUERY = 100

/** The Kanban board of one project: four columns, drag and drop, filters, and the task dialogs. */
export function TaskBoard({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { request } = useAuth()
  const tasks = useTasks(projectId)
  const membersQuery = useMembers(projectId)
  const move = useMoveTask(projectId)
  const del = useDeleteTask(projectId)

  const [dialog, setDialog] = useState<Dialog>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])
  const [filters, setFilters] = useFilters(membersQuery.isSuccess ? members : null)

  const all = useMemo(() => tasks.data ?? [], [tasks.data])
  const visible = useMemo(() => filterTasks(all, filters), [all, filters])
  const columns = useMemo(() => byColumn(visible), [visible])
  const nameOf = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName])), [members])
  const activeTask = activeId ? all.find((task) => task.id === activeId) : undefined

  const sensors = useSensors(
    // A little movement is needed before a drag starts, so a plain click never counts as one.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const task = all.find((x) => x.id === active.id)
      return task ? t('tasks.announcePickedUp', { title: task.title }) : undefined
    },
    onDragOver: ({ active, over }) => {
      const task = all.find((x) => x.id === active.id)
      const column = over ? statusOf(columns, String(over.id)) : undefined
      return task && column
        ? t('tasks.announceOver', { title: task.title, column: t(`status.${column}`) })
        : undefined
    },
    onDragEnd: ({ active, over }) => {
      const task = all.find((x) => x.id === active.id)
      const column = over ? statusOf(columns, String(over.id)) : undefined
      return task && column
        ? t('tasks.announceDropped', { title: task.title, column: t(`status.${column}`) })
        : undefined
    },
    onDragCancel: ({ active }) => {
      const task = all.find((x) => x.id === active.id)
      return task ? t('tasks.announceCancelled', { title: task.title }) : undefined
    },
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over) return
    // Dropped on the lower half of a task in another column = behind it.
    const dragged = active.rect.current.translated
    const after =
      dragged !== null && dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2
    const target = dropTarget(columns, String(active.id), String(over.id), after)
    if (target)
      move.mutate(target, { onError: () => toast.show({ message: t('tasks.moveFailed') }) })
  }

  // Undo is a plain function: it must still work after the dialog that started it is gone.
  function undoDelete(task: Task) {
    restoreTask(request, task.id)
      .then(() => {
        void qc.invalidateQueries({ queryKey: taskKeys.all(projectId) })
        toast.show({ message: t('tasks.restored', { title: task.title }) })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(t, error) }))
  }

  if (tasks.isPending) return <LoadingState label={t('tasks.loading')} />
  if (tasks.isError)
    return (
      <ErrorState message={errorMessage(t, tasks.error)} onRetry={() => void tasks.refetch()} />
    )

  return (
    <section aria-labelledby="tasks-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tasks-title" className="text-xl font-semibold">
          {t('tasks.title')}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/projects/${encodeURIComponent(projectId)}/trash`}
            className="text-sm font-medium text-primary underline"
          >
            {t('tasks.trash')}
          </Link>
          <Button type="button" onClick={() => setDialog({ kind: 'create', status: 'todo' })}>
            {t('tasks.new')}
          </Button>
        </div>
      </div>

      <FilterBar
        filters={filters}
        members={members}
        onChange={setFilters}
        shown={visible.length}
        total={all.length}
      />

      {all.length === 0 && <p className="text-muted">{t('tasks.emptyBoard')}</p>}
      {all.length > 0 && visible.length === 0 && <p className="text-muted">{t('tasks.noMatch')}</p>}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: t('tasks.dragInstructions') },
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={columns[status]}
              nameOf={nameOf}
              onAdd={() => setDialog({ kind: 'create', status })}
              onOpen={(task) => setDialog({ kind: 'edit', task })}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <TaskCardView
              task={activeTask}
              assigneeName={nameOf.get(activeTask.assigneeId ?? '')}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {dialog && (
        <TaskFormDialog
          projectId={projectId}
          members={members}
          {...(dialog.kind === 'edit' ? { task: dialog.task } : { initialStatus: dialog.status })}
          onClose={() => setDialog(null)}
          onSaved={() => {
            toast.show({ message: dialog.kind === 'edit' ? t('tasks.saved') : t('tasks.created') })
            setDialog(null)
          }}
          onDelete={(task) => {
            setDialog(null)
            setDeleting(task)
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('tasks.deleteTitle')}
          message={t('tasks.deleteMessage', { title: deleting.title })}
          confirmLabel={t('tasks.deleteConfirm')}
          pendingLabel={t('tasks.deleting')}
          pending={del.isPending}
          error={del.error ? errorMessage(t, del.error) : undefined}
          onCancel={() => {
            del.reset()
            setDeleting(null)
          }}
          onConfirm={() =>
            del.mutate(deleting.id, {
              onSuccess: () => {
                toast.show({
                  message: t('tasks.movedToTrash', { title: deleting.title }),
                  actionLabel: t('tasks.undo'),
                  onAction: () => undoDelete(deleting),
                })
                setDeleting(null)
              },
            })
          }
        />
      )}
    </section>
  )
}

/** Which column a dragged-over id belongs to (a column itself, or a task inside one). */
function statusOf(columns: Columns, overId: string): TaskStatus | undefined {
  for (const status of STATUSES) {
    if (overId === columnId(status) || columns[status].some((task) => task.id === overId))
      return status
  }
  return undefined
}

interface ColumnProps {
  status: TaskStatus
  tasks: Task[]
  nameOf: Map<string, string>
  onAdd: () => void
  onOpen: (task: Task) => void
}

function Column({ status, tasks, nameOf, onAdd, onOpen }: ColumnProps) {
  const { t } = useTranslation()
  // The whole column accepts drops, so a card can go into an empty column or below the last card.
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) })
  const name = t(`status.${status}`)
  return (
    <section
      aria-label={t('tasks.columnLabel', { column: name, count: tasks.length })}
      className="rounded-2xl border border-border bg-surface-2 p-3"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-sm text-muted" aria-hidden="true">
            {tasks.length}
          </span>
        </h3>
        <button
          type="button"
          onClick={onAdd}
          aria-label={t('tasks.addIn', { column: name })}
          className="grid h-8 w-8 place-items-center rounded-full text-lg font-semibold text-primary-fg hover:bg-primary-bg"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`min-h-24 space-y-2 rounded-xl p-1 ${isOver ? 'bg-primary-bg' : ''}`}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              assigneeName={task.assigneeId ? nameOf.get(task.assigneeId) : undefined}
              onOpen={() => onOpen(task)}
            />
          ))}
          {tasks.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted">{t('tasks.empty')}</li>
          )}
        </ul>
      </SortableContext>
    </section>
  )
}

interface FilterBarProps {
  filters: Filters
  members: Member[]
  onChange: (next: Filters) => void
  shown: number
  total: number
}

function FilterBar({ filters, members, onChange, shown, total }: FilterBarProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          id="filter-q"
          type="search"
          label={t('tasks.search')}
          placeholder={t('tasks.searchPlaceholder')}
          value={filters.q}
          maxLength={MAX_QUERY}
          autoComplete="off"
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
        <SelectField
          id="filter-priority"
          label={t('tasks.priorityFilter')}
          value={filters.priority}
          onChange={(e) =>
            onChange({ ...filters, priority: isPriority(e.target.value) ? e.target.value : '' })
          }
        >
          <option value="">{t('tasks.all')}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="filter-assignee"
          label={t('tasks.assigneeFilter')}
          value={filters.assignee}
          onChange={(e) => onChange({ ...filters, assignee: e.target.value })}
        >
          <option value="">{t('tasks.all')}</option>
          <option value={UNASSIGNED}>{t('tasks.unassigned')}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </SelectField>
      </div>
      {hasFilters(filters) && (
        <p className="flex flex-wrap items-center gap-3 text-sm text-muted" role="status">
          {t('tasks.showing', { shown, total })}
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="font-medium text-primary underline"
          >
            {t('tasks.clearFilters')}
          </button>
        </p>
      )}
    </div>
  )
}

/**
 * The filters live in the address (?q=&priority=&assignee=), so a refresh, the Back button and a shared
 * link all keep them. Whatever is in the address is checked before use.
 */
function useFilters(members: Member[] | null): [Filters, (next: Filters) => void] {
  const [params, setParams] = useSearchParams()
  const priority = params.get('priority')
  const assignee = params.get('assignee') ?? ''
  const known =
    assignee === UNASSIGNED || members === null || members.some((m) => m.userId === assignee)

  const filters: Filters = {
    q: (params.get('q') ?? '').slice(0, MAX_QUERY),
    priority: isPriority(priority) ? priority : '',
    assignee: known ? assignee : '',
  }

  function set(next: Filters) {
    setParams(
      (current) => {
        const out = new URLSearchParams(current) // keep anything else in the address
        for (const [key, value] of Object.entries(next)) {
          if (value) out.set(key, value)
          else out.delete(key)
        }
        return out
      },
      { replace: true }, // typing in the search box should not fill the Back button's history
    )
  }
  return [filters, set]
}
