import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { Task } from '../api/types'
import { errorMessage } from '../auth/errors'
import { BackLink } from '../components/BackLink'
import { Alert, Button } from '../components/forms'
import { Icon } from '../components/Icon'
import { EmptyState, ErrorState, LoadingState } from '../components/states'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/toast'
import { useProject } from '../features/projects/hooks'
import { useRestoreTask, useTrashedTasks } from '../features/tasks/hooks'
import { TrashedTaskDialog } from '../features/tasks/TrashedTaskDialog'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { daysUntil, formatDate } from '../lib/format'

/** Deleted tasks of one project. Any member can restore them until the date shown. */
export function TaskTrashPage() {
  const { t, i18n } = useTranslation()
  const { projectId = '' } = useParams()
  const toast = useToast()
  const project = useProject(projectId)
  const trashed = useTrashedTasks(projectId)
  const restore = useRestoreTask(projectId)
  // The task open for reading, if any.
  const [viewing, setViewing] = useState<Task | null>(null)
  useDocumentTitle(t('tasks.trashTitle'))

  function restoreTask(task: Task) {
    restore.mutate(task.id, {
      onSuccess: () => {
        setViewing(null)
        toast.show({ message: t('tasks.restored', { title: task.title }) })
      },
    })
  }

  const notFound =
    (project.error instanceof ApiError && project.error.status === 404) ||
    (trashed.error instanceof ApiError && trashed.error.status === 404)

  const back = (
    <p>
      <BackLink to={`/projects/${encodeURIComponent(projectId)}`}>
        {t('tasks.backToBoard')}
      </BackLink>
    </p>
  )

  if (notFound) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold">{t('projects.notFoundTitle')}</h1>
        <p className="mt-2 text-muted">{t('projects.notFoundText')}</p>
        <p className="mt-4">
          <BackLink to="/">{t('projects.back')}</BackLink>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {back}
      <div>
        <h1 className="text-3xl font-bold">{t('tasks.trashTitle')}</h1>
        {project.data && <p className="mt-1 break-words text-muted">{project.data.name}</p>}
        <p className="mt-1 text-muted">{t('tasks.trashIntro')}</p>
      </div>

      {restore.isError && <Alert>{errorMessage(t, restore.error)}</Alert>}

      {trashed.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : trashed.isError ? (
        <ErrorState
          message={errorMessage(t, trashed.error)}
          onRetry={() => void trashed.refetch()}
        />
      ) : trashed.data.length === 0 ? (
        <EmptyState title={t('tasks.trashEmpty')} />
      ) : (
        <ul className="space-y-3">
          {trashed.data.map((task) => {
            const restoring = restore.isPending && restore.variables === task.id
            return (
              <li
                key={task.id}
                className="relative flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-primary"
              >
                <div className="min-w-0 space-y-1">
                  <h2 className="break-words text-lg font-semibold">
                    {/* The whole card opens the task; its button is the title, so the name stays the title. */}
                    <button
                      type="button"
                      onClick={() => setViewing(task)}
                      className="text-left after:absolute after:inset-0 after:rounded-2xl after:content-['']"
                    >
                      {task.title}
                    </button>
                  </h2>
                  <StatusBadge status={task.status} />
                  {task.purgeAt && (
                    <p className="text-sm text-muted">
                      {t('trash.deletedOn', { date: formatDate(task.purgeAt, i18n.language) })} ·{' '}
                      {t('trash.daysLeft', { days: daysUntil(task.purgeAt) })}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="soft"
                  className="relative z-10" // above the card's own click area
                  disabled={restore.isPending}
                  aria-busy={restoring}
                  aria-label={`${t('trash.restore')}: ${task.title}`}
                  onClick={() => restoreTask(task)}
                >
                  <Icon name="restore" />
                  {restoring ? t('trash.restoring') : t('trash.restore')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {viewing && (
        <TrashedTaskDialog
          task={viewing}
          restoring={restore.isPending && restore.variables === viewing.id}
          onRestore={() => restoreTask(viewing)}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}
