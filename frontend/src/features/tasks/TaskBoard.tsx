import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  TouchSensor,
  closestCorners,
  defaultDropAnimation,
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { restoreTask } from '../../api/tasks'
import type { Member, Task, TaskStatus } from '../../api/types'
import { useAuth } from '../../auth/context'
import { errorMessage } from '../../auth/errors'
import { ChoiceSwitch } from '../../components/ChoiceSwitch'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button, CompactSelectField, CompactTextField, SelectField } from '../../components/forms'
import { Icon, type IconName } from '../../components/Icon'
import { Menu } from '../../components/Menu'
import { Modal } from '../../components/Modal'
import { ErrorState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../components/toast'
import { TrashLink } from '../../components/TrashLink'
import { useQueryClient } from '@tanstack/react-query'
import { useMembers } from '../projects/hooks'
import { AssigneePicker } from './AssigneePicker'
import {
  assigneesOf,
  NO_FILTERS,
  PRIORITIES,
  STATUSES,
  UNASSIGNED,
  byColumn,
  columnId,
  droppedOnLowerHalf,
  filterTasks,
  hasFilters,
  isPriority,
  type Columns,
  type Filters,
  type Move,
} from './boardLogic'
import { loadBoardLayout, saveBoardLayout, type BoardLayout } from './boardLayout'
import {
  SORTS,
  dropWithSorts,
  loadColumnSorts,
  saveColumnSorts,
  sortColumn,
  type ColumnSort,
} from './columnSort'
import { HoldReasonDialog } from './HoldReasonDialog'
import { taskKeys, useDeleteTask, useMoveTask, useTasks } from './hooks'
import { MouseOrPenSensor } from './sensors'
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

/** The Kanban board of one project: five columns, drag and drop, filters, and the task dialogs. */
export function TaskBoard({
  projectId,
  newTaskOpen,
  onNewTaskClose,
}: {
  projectId: string
  /** The page's "New task" button lives outside the board, in the project header. */
  newTaskOpen: boolean
  onNewTaskClose: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { request } = useAuth()
  const tasks = useTasks(projectId)
  const membersQuery = useMembers(projectId)
  const move = useMoveTask(projectId)
  const del = useDeleteTask(projectId)

  const [columnDialog, setColumnDialog] = useState<Dialog>(null)
  const dialog: Dialog = newTaskOpen ? { kind: 'create', status: 'todo' } : columnDialog
  function closeDialog() {
    setColumnDialog(null)
    onNewTaskClose()
  }
  const [deleting, setDeleting] = useState<Task | null>(null)
  // A card dropped on "On hold", waiting to hear why. It stays where it was until then.
  const [holding, setHolding] = useState<{ move: Move; task: Task } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [movedByKeyboard, setMovedByKeyboard] = useState(false)
  const [layout, setLayout] = useState(loadBoardLayout)
  function chooseLayout(next: BoardLayout) {
    setLayout(next)
    saveBoardLayout(next)
  }

  // Which column is in view when the board is swiped sideways on a phone.
  const scroller = useRef<HTMLDivElement>(null)
  const [columnInView, setColumnInView] = useState(0)
  const [boardScrolls, setBoardScrolls] = useState(false)
  function onBoardScroll() {
    const el = scroller.current
    if (!el || el.children.length < 2) return
    const [first, second] = [...el.children] as [HTMLElement, HTMLElement]
    const step = second.offsetLeft - first.offsetLeft
    if (step > 0) setColumnInView(Math.round(el.scrollLeft / step))
  }

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])
  const [filters, setFilters] = useFilters(membersQuery.isSuccess ? members : null)

  const all = useMemo(() => tasks.data ?? [], [tasks.data])
  const visible = useMemo(() => filterTasks(all, filters), [all, filters])
  // `columns` keeps the arranged order, which is what a drop works from. `shown` is what is on screen.
  const columns = useMemo(() => byColumn(visible), [visible])
  const [sorts, setSorts] = useState(() => loadColumnSorts(projectId))
  const shown = useMemo(() => {
    const sorted = { ...columns }
    for (const status of STATUSES) {
      sorted[status] = sortColumn(columns[status], sorts[status])
    }
    return sorted
  }, [columns, sorts])
  function chooseSort(status: TaskStatus, sort: ColumnSort) {
    const next = { ...sorts, [status]: sort }
    setSorts(next)
    saveColumnSorts(projectId, next)
  }
  const nameOf = useMemo(() => new Map(members.map((m) => [m.userId, m.email])), [members])
  const activeTask = activeId ? all.find((task) => task.id === activeId) : undefined

  const sensors = useSensors(
    // A little movement is needed before a drag starts, so a plain click never counts as one.
    useSensor(MouseOrPenSensor, { activationConstraint: { distance: 6 } }),
    // A finger must rest on the card for a moment first, so scrolling and swiping never pick one up.
    // The tolerance allows for the small shake of a finger held still; moving further cancels the press.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
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
    pointerY.current = null // stays null for a keyboard drag, which never moves a pointer
    setMovedByKeyboard(event.activatorEvent instanceof KeyboardEvent)
    const el = scroller.current
    setBoardScrolls(!!el && el.scrollWidth > el.clientWidth)
    setActiveId(String(event.active.id))
  }

  // Where the mouse/finger is (screen y) while a card is being dragged.
  const pointerY = useRef<number | null>(null)
  const dragging = activeId !== null
  useEffect(() => {
    if (!dragging) return
    const track = (event: PointerEvent) => {
      pointerY.current = event.clientY
    }
    const trackFinger = (event: TouchEvent) => {
      pointerY.current = event.touches[0]?.clientY ?? pointerY.current
    }
    window.addEventListener('pointermove', track)
    window.addEventListener('touchmove', trackFinger, { passive: true })
    return () => {
      window.removeEventListener('pointermove', track)
      window.removeEventListener('touchmove', trackFinger)
    }
  }, [dragging])

  // Snapping is off during a drag. When it comes back the browser picks a column by itself, which on a phone
  // could hide the card that was just moved. So go to the column it was dropped in, or, when it was dropped
  // on nothing, stay where the person let go.
  const scrollAtDrop = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (dragging || scrollAtDrop.current === null) return
    if (scroller.current) scroller.current.scrollLeft = scrollAtDrop.current
    scrollAtDrop.current = null
  }, [dragging])

  function endDrag(droppedIn?: TaskStatus) {
    const el = scroller.current
    const column = droppedIn && el?.children[STATUSES.indexOf(droppedIn)]
    if (el) {
      scrollAtDrop.current = column
        ? el.scrollLeft + column.getBoundingClientRect().left - el.getBoundingClientRect().left
        : el.scrollLeft
    }
    setActiveId(null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    endDrag(over ? statusOf(columns, String(over.id)) : undefined)
    if (!over) return
    // Dropped on the lower half of a task in another column = behind it. With a mouse or finger that is
    // judged by where the pointer really is; with the keyboard (no pointer) by the middle of the moved card.
    // (The pointer is read directly: the library's own numbers drift when the page scrolls during a drag.)
    const after = droppedOnLowerHalf(over.rect, pointerY.current, active.rect.current.translated)
    const target = dropWithSorts(columns, sorts, String(active.id), String(over.id), after)
    if (target === 'sorted') toast.show({ message: t('tasks.sortedNoArrange') })
    else if (target) {
      const task = all.find((x) => x.id === target.taskId)
      if (target.status === 'on_hold' && task && task.status !== 'on_hold')
        setHolding({ move: target, task })
      else sendMove(target)
    }
  }

  function sendMove(target: Move) {
    move.mutate(target, { onError: () => toast.show({ message: t('tasks.moveFailed') }) })
  }

  // A card that changes column is built anew, so a keyboard user's focus needs to follow it once it has landed.
  const refocusAfterHold = useRef<string | null>(null)
  useEffect(() => {
    const id = refocusAfterHold.current
    if (!id || all.find((x) => x.id === id)?.status !== 'on_hold') return
    refocusAfterHold.current = null
    scroller.current
      ?.querySelector<HTMLElement>(`[data-task-handle="${id}"]`)
      ?.focus({ preventScroll: true })
  }, [all])

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
    // On phones the extra space at the bottom keeps the last cards clear of the floating "New task" button.
    <section aria-labelledby="tasks-title" className="space-y-4 max-sm:pb-20">
      <h2 id="tasks-title" className="sr-only">
        {t('tasks.title')}
      </h2>

      <FilterBar
        projectId={projectId}
        filters={filters}
        members={members}
        tasks={all}
        onChange={setFilters}
        shown={visible.length}
        total={all.length}
        layout={layout}
        onLayoutChange={chooseLayout}
      />

      {all.length === 0 && <p className="text-muted">{t('tasks.emptyBoard')}</p>}
      {all.length > 0 && visible.length === 0 && <p className="text-muted">{t('tasks.noMatch')}</p>}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Near the edge of a phone screen the board scrolls sideways by itself during a drag. The zone is
        // narrow because a card can be held anywhere, even close to the edge, without meaning to scroll, and
        // the speed is one a person can follow (the library's default crosses a column in a fifth of a second).
        autoScroll={{ threshold: { x: 0.12, y: 0.2 }, acceleration: 3 }}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: t('tasks.dragInstructions') },
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => endDrag()}
      >
        {/*
          Phones: one column at a time, swipe sideways. Tablets: two across, with Done filling the last row.
          Wide screens: all five, or the same as tablets if the person chose that.
          Snapping is off during a drag: it would fight with scrolling by itself near the edge.
        */}
        <div
          ref={scroller}
          onScroll={onBoardScroll}
          className={`-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 ${
            layout === 'row' ? 'xl:grid-cols-5' : ''
          } ${dragging ? '' : 'snap-x snap-mandatory'}`}
        >
          {STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={shown[status]}
              nameOf={nameOf}
              sort={sorts[status]}
              layout={layout}
              onSort={(sort) => chooseSort(status, sort)}
              onOpen={(task) => setColumnDialog({ kind: 'edit', task })}
            />
          ))}
        </div>
        {/* Decoration only: each column already announces its own name and task count. */}
        <div aria-hidden="true" className="flex items-center justify-center gap-1.5 sm:hidden">
          {STATUSES.map((status, index) => (
            <span
              key={status}
              className={`h-1.5 rounded-full ${
                index === columnInView ? 'w-4 bg-primary' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>
        {/*
          The drop animation first scrolls the board back to where the card came from, away from where it was
          just dropped. So a board that scrolls sideways goes without it.
        */}
        <DragOverlay dropAnimation={boardScrolls ? null : defaultDropAnimation}>
          {/*
            The plain outer div must stay: dnd-kit measures the overlay's first child, and a tilted element
            measures wider than it is. Keyboard moves would then pick the card itself as the next place.
            The tilt is for dragging by hand only. It is only a picture of the card: its buttons are the real
            card's, so they must not be announced or reached a second time.
          */}
          {activeTask ? (
            <div aria-hidden="true" inert>
              <div className={movedByKeyboard ? '' : '-rotate-[1.5deg] motion-reduce:rotate-0'}>
                <TaskCardView
                  task={activeTask}
                  assignees={assigneesOf(activeTask, nameOf)}
                  picked
                  lifted
                />
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {dialog && (
        <TaskFormDialog
          projectId={projectId}
          members={members}
          {...(dialog.kind === 'edit'
            ? {
                task: dialog.task,
                // The rest of the form edits what the task was when opened; these change as it stays open.
                subtasks:
                  all.find((x) => x.id === dialog.task.id)?.subtasks ?? dialog.task.subtasks,
              }
            : { initialStatus: dialog.status })}
          onClose={closeDialog}
          onSaved={() => {
            toast.show({ message: dialog.kind === 'edit' ? t('tasks.saved') : t('tasks.created') })
            closeDialog()
          }}
          onDelete={(task) => {
            closeDialog()
            setDeleting(task)
          }}
        />
      )}

      {holding && (
        <HoldReasonDialog
          taskTitle={holding.task.title}
          onCancel={() => setHolding(null)}
          onConfirm={(holdReason) => {
            if (movedByKeyboard) refocusAfterHold.current = holding.task.id
            sendMove({ ...holding.move, holdReason })
            setHolding(null)
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('tasks.deleteTitle', { title: deleting.title })}
          message={t('tasks.deleteMessage')}
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
  sort: ColumnSort
  layout: BoardLayout
  onSort: (sort: ColumnSort) => void
  onOpen: (task: Task) => void
}

// The soft "-bg" tints would vanish against the column, so the line uses each status's strong color.
const COLUMN_LINE: Record<TaskStatus, string> = {
  todo: 'bg-primary',
  in_progress: 'bg-sky-fg',
  review: 'bg-peach-fg',
  on_hold: 'bg-lemon-fg',
  done: 'bg-mint-fg',
}

function Column({ status, tasks, nameOf, sort, layout, onSort, onOpen }: ColumnProps) {
  const { t } = useTranslation()
  // The whole column accepts drops, so a card can go into an empty column or below the last card.
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) })
  const name = t(`status.${status}`)
  return (
    <section
      aria-label={t('tasks.columnLabel', { column: name, count: tasks.length })}
      className={`relative w-[86%] shrink-0 snap-start rounded-2xl border border-border bg-surface-2 p-3 sm:w-auto sm:last:col-span-2 ${
        layout === 'row' ? 'xl:last:col-span-1' : ''
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-4 top-0 h-[3px] rounded-b-full ${COLUMN_LINE[status]}`}
      />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-sm text-muted" aria-hidden="true">
            {tasks.length}
          </span>
        </h3>
        <Menu
          floating // on phones the columns sit in a sideways scroller, which would cut the menu off
          label={t('tasks.sortIn', { column: name, sort: t(`tasks.sort_${sort}`) })}
          trigger={<Icon name="sort" />}
          // Filled in while the column is sorted, so it is clear why cards are not in the arranged order.
          triggerClassName={`grid h-[30px] w-[30px] place-items-center rounded-full hover:bg-primary-bg ${
            sort === 'manual' ? 'text-muted' : 'bg-primary-bg text-primary-fg'
          }`}
          items={SORTS.map((value) => ({
            key: value,
            label: t(`tasks.sort_${value}`),
            checked: value === sort,
            onSelect: () => onSort(value),
          }))}
        />
      </div>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          // No side padding: the list's edge must line up with its cards. Otherwise the left arrow key
          // counts the card's own column as "to the left", and needs two presses to leave it.
          className={`min-h-24 space-y-2 rounded-xl py-1 ${isOver ? 'bg-primary-bg' : ''}`}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              assignees={assigneesOf(task, nameOf)}
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
  projectId: string
  filters: Filters
  members: Member[]
  tasks: Task[]
  /** Only the filter(s) that changed, so two quick changes in a row cannot undo each other. */
  onChange: (changed: Partial<Filters>) => void
  shown: number
  total: number
  layout: BoardLayout
  onLayoutChange: (layout: BoardLayout) => void
}

const SELECT_WIDTH = 'flex-[0_1_150px] max-sm:hidden'

function PriorityOptions() {
  const { t } = useTranslation()
  return (
    <>
      <option value="">{t('tasks.all')}</option>
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {t(`priority.${p}`)}
        </option>
      ))}
    </>
  )
}

/**
 * Whose tasks to show, for wider screens: a menu where any number of people can be ticked, plus "Unassigned".
 * "All" takes every tick off. The button says what is chosen, so the board never hides tasks without saying so.
 */
function AssigneeFilter({
  members,
  chosen,
  onChange,
}: {
  members: Member[]
  chosen: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useTranslation()
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])
  const summary =
    chosen.length === 0
      ? t('tasks.all')
      : chosen.length === 1
        ? chosen[0] === UNASSIGNED
          ? t('tasks.unassigned')
          : (members.find((m) => m.userId === chosen[0])?.email ?? t('tasks.all'))
        : t('tasks.assigneesChosen', { count: chosen.length })
  return (
    <Menu
      className={SELECT_WIDTH}
      multiple
      label={`${t('tasks.assigneeFilter')}: ${summary}`}
      triggerClassName="relative flex h-10 w-full items-center gap-2 rounded-xl border border-border bg-surface pl-3 pr-2 text-left text-text focus:border-primary"
      trigger={
        <>
          <span className="shrink-0 text-muted">
            <Icon name="users" />
          </span>
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          <span className="shrink-0 text-muted">
            <Icon name="chevron-down" size={16} />
          </span>
        </>
      }
      items={[
        {
          key: 'all',
          label: t('tasks.all'),
          checked: chosen.length === 0,
          onSelect: () => onChange([]),
        },
        {
          key: UNASSIGNED,
          label: t('tasks.unassigned'),
          checked: chosen.includes(UNASSIGNED),
          onSelect: () => toggle(UNASSIGNED),
        },
        ...members.map((m) => ({
          key: m.userId,
          label: m.email,
          checked: chosen.includes(m.userId),
          onSelect: () => toggle(m.userId),
        })),
      ]}
    />
  )
}

/** The phone version of the two lists. Nothing changes on the board or in the address until "Show N tasks". */
function FilterSheet({
  filters,
  members,
  tasks,
  onChange,
  onClose,
}: {
  filters: Filters
  members: Member[]
  tasks: Task[]
  onChange: (changed: Partial<Filters>) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [priority, setPriority] = useState(filters.priority)
  const [assignees, setAssignees] = useState(filters.assignees)
  const count = filterTasks(tasks, { ...filters, priority, assignees }).length
  return (
    <Modal
      title={t('tasks.filters')}
      variant="drawer"
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <div className="space-y-3">
        <SelectField
          id="sheet-priority"
          label={t('tasks.priorityFilter')}
          value={priority}
          onChange={(e) => setPriority(isPriority(e.target.value) ? e.target.value : '')}
        >
          <PriorityOptions />
        </SelectField>
        <AssigneePicker
          id="sheet-assignee"
          legend={t('tasks.assigneeFilter')}
          unassignedLabel={t('tasks.unassigned')}
          members={members}
          selected={assignees}
          onChange={setAssignees}
        />
        <div className="flex flex-col gap-2 pt-1">
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              onChange({ priority, assignees })
              onClose()
            }}
          >
            {t('tasks.showCount', { count })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setPriority('')
              setAssignees([])
            }}
          >
            {t('tasks.clearFilters')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function FilterBar({
  projectId,
  filters,
  members,
  tasks,
  onChange,
  shown,
  total,
  layout,
  onLayoutChange,
}: FilterBarProps) {
  const { t } = useTranslation()
  const [sheetOpen, setSheetOpen] = useState(false)
  const inSheet = (filters.priority ? 1 : 0) + filters.assignees.length
  const nameFor = (id: string) =>
    id === UNASSIGNED ? t('tasks.unassigned') : members.find((m) => m.userId === id)?.email
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CompactTextField
          id="filter-q"
          type="search"
          icon="search"
          className="flex-1"
          label={t('tasks.search')}
          placeholder={t('tasks.searchPlaceholder')}
          value={filters.q}
          maxLength={MAX_QUERY}
          autoComplete="off"
          onChange={(e) => onChange({ q: e.target.value })}
        />
        <Button
          type="button"
          variant="soft"
          className="shrink-0 sm:hidden"
          aria-label={inSheet > 0 ? t('tasks.filtersCount', { count: inSheet }) : undefined}
          onClick={() => setSheetOpen(true)}
        >
          <Icon name="filter" />
          {t('tasks.filters')}
          {inSheet > 0 && (
            <span
              aria-hidden="true"
              className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs text-on-primary"
            >
              {inSheet}
            </span>
          )}
        </Button>
        <CompactSelectField
          id="filter-priority"
          icon="filter"
          className={SELECT_WIDTH}
          label={t('tasks.priorityFilter')}
          value={filters.priority}
          onChange={(e) => onChange({ priority: isPriority(e.target.value) ? e.target.value : '' })}
        >
          <PriorityOptions />
        </CompactSelectField>
        <AssigneeFilter
          members={members}
          chosen={filters.assignees}
          onChange={(assignees) => onChange({ assignees })}
        />
        {/* Only wide screens have a choice: smaller ones already use the one layout that fits them. */}
        <ChoiceSwitch
          className="shrink-0 max-xl:hidden"
          label={t('tasks.layoutLabel')}
          value={layout}
          onChange={onLayoutChange}
          options={[
            { value: 'row', icon: 'columns', label: t('tasks.layout_row') },
            { value: 'two', icon: 'grid', label: t('tasks.layout_two') },
          ]}
        />
        <TrashLink
          to={`/projects/${encodeURIComponent(projectId)}/trash`}
          label={t('tasks.trash')}
          iconOnlyOnPhone
        />
      </div>
      {sheetOpen && (
        <FilterSheet
          filters={filters}
          members={members}
          tasks={tasks}
          onChange={onChange}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {hasFilters(filters) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t('tasks.filteringBy')}</span>
          {filters.q.trim() !== '' && (
            <FilterChip icon="search" text={filters.q} onRemove={() => onChange({ q: '' })} />
          )}
          {filters.priority !== '' && (
            <FilterChip
              icon="filter"
              text={t(`priority.${filters.priority}`)}
              onRemove={() => onChange({ priority: '' })}
            />
          )}
          {filters.assignees.map((id) => (
            <FilterChip
              key={id}
              icon="users"
              text={nameFor(id) ?? id}
              onRemove={() => onChange({ assignees: filters.assignees.filter((x) => x !== id) })}
            />
          ))}
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="font-medium text-primary underline"
          >
            {t('tasks.clearFilters')}
          </button>
          <span className="text-muted" role="status">
            {t('tasks.showing', { shown, total })}
          </span>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  icon,
  text,
  onRemove,
}: {
  icon: IconName
  text: string
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-primary-bg py-1 pl-3 pr-1.5 font-medium text-primary-fg">
      <Icon name={icon} size={14} />
      <span className="min-w-0 truncate">{text}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('tasks.removeFilter', { name: text })}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-surface"
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  )
}

/**
 * The filters are copied to the address (?q=&priority=&assignee=), so a refresh and a shared link keep
 * them. They are read from the address once, when the board opens, and checked before use. While the board
 * is open they live in ordinary state (which queues quick changes correctly) and the address follows.
 */
function useFilters(members: Member[] | null): [Filters, (changed: Partial<Filters>) => void] {
  const [params, setParams] = useSearchParams()
  const [chosen, setChosen] = useState<Filters>(() => {
    const priority = params.get('priority')
    return {
      q: (params.get('q') ?? '').slice(0, MAX_QUERY),
      priority: isPriority(priority) ? priority : '',
      assignees: [...new Set((params.get('assignee') ?? '').split(',').filter(Boolean))].slice(
        0,
        100,
      ),
    }
  })

  // A person in the address who is not a member (any more) is left out.
  const filters: Filters =
    members === null
      ? chosen
      : {
          ...chosen,
          assignees: chosen.assignees.filter(
            (id) => id === UNASSIGNED || members.some((m) => m.userId === id),
          ),
        }

  useEffect(() => {
    setParams(
      (current) => {
        const out = new URLSearchParams(current) // keep anything else in the address
        const values = {
          q: chosen.q,
          priority: chosen.priority,
          assignee: chosen.assignees.join(','), // ?assignee=id1,id2
        }
        for (const [key, value] of Object.entries(values)) {
          if (value) out.set(key, value)
          else out.delete(key)
        }
        return out
      },
      // replace: typing in the search box should not fill the Back button's history
      { replace: true },
    )
  }, [chosen, setParams])

  return [filters, (changed) => setChosen((current) => ({ ...current, ...changed }))]
}
