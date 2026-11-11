import { useTranslation } from 'react-i18next'
import type { Task } from '../../api/types'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/forms'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { PriorityBadge, StatusBadge } from '../../components/StatusBadge'
import { formatDay, personName } from '../../lib/format'
import { useMembers } from '../projects/hooks'

/** A task in the trash, to read before restoring it. Nothing can be changed until it is back on the board. */
export function TrashedTaskDialog({
  task,
  restoring,
  onRestore,
  onClose,
}: {
  task: Task
  restoring: boolean
  onRestore: () => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const members = useMembers(task.projectId).data ?? []
  // Someone who has left the project since is not named.
  const people = task.assigneeIds.flatMap((id) => {
    const member = members.find((m) => m.userId === id)
    return member ? [{ id, name: personName(member) }] : []
  })
  const day = (value: string) => formatDay(value, i18n.language)
  const dates =
    task.startDate && task.dueDate
      ? `${day(task.startDate)} – ${day(task.dueDate)}`
      : task.startDate
        ? t('tasks.viewStarts', { day: day(task.startDate) })
        : task.dueDate
          ? t('tasks.viewEnds', { day: day(task.dueDate) })
          : t('tasks.viewNoDates')
  const heading = 'text-sm font-medium text-muted'

  return (
    <Modal title={task.title} onClose={restoring ? () => {} : onClose}>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm text-muted">
          <span className="mt-0.5 shrink-0">
            <Icon name="trash" />
          </span>
          {t('tasks.trashedNote')}
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
        </div>
        {task.status === 'on_hold' && task.holdReason && (
          <section className="space-y-1">
            <h3 className={heading}>{t('tasks.viewHold')}</h3>
            <p className="whitespace-pre-wrap break-words">{task.holdReason}</p>
          </section>
        )}
        <section className="space-y-1">
          <h3 className={heading}>{t('tasks.viewDescription')}</h3>
          {task.description ? (
            <p className="whitespace-pre-wrap break-words">{task.description}</p>
          ) : (
            <p className="text-muted">{t('tasks.viewNoDescription')}</p>
          )}
        </section>
        <section className="space-y-1">
          <h3 className={heading}>{t('tasks.viewDates')}</h3>
          <p>{dates}</p>
        </section>
        <section className="space-y-1">
          <h3 className={heading}>{t('tasks.assigneeLabel')}</h3>
          {people.length === 0 ? (
            <p className="text-muted">{t('tasks.unassigned')}</p>
          ) : (
            <ul className="space-y-1">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <Avatar id={p.id} name={p.name} size={24} />
                  <span className="min-w-0 break-words">{p.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {task.subtasks.length > 0 && (
          <section className="space-y-1">
            <h3 className={heading}>{t('tasks.viewSubtasks')}</h3>
            <ul className="space-y-1">
              {task.subtasks.map((s) => (
                <li key={s.id} className="flex items-start gap-2">
                  <span className={`mt-1 shrink-0 ${s.done ? 'text-primary' : 'text-muted'}`}>
                    <Icon name={s.done ? 'check-circle' : 'circle'} />
                  </span>
                  <span className="sr-only">
                    {s.done ? t('tasks.viewSubtaskDone') : t('tasks.viewSubtaskOpen')}:{' '}
                  </span>
                  <span
                    className={`min-w-0 break-words ${s.done ? 'text-muted line-through' : ''}`}
                  >
                    {s.title}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="soft" onClick={onClose} disabled={restoring}>
            {t('common.close')}
          </Button>
          <Button type="button" onClick={onRestore} disabled={restoring} aria-busy={restoring}>
            <Icon name="restore" />
            {restoring ? t('trash.restoring') : t('trash.restore')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
