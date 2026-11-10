import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../../auth/errors'
import { Button } from '../../components/forms'
import { Modal } from '../../components/Modal'
import { ErrorState, LoadingState } from '../../components/states'
import { useMembers } from '../projects/hooks'
import { useTasks } from '../tasks/hooks'
import { TaskFormDialog } from '../tasks/TaskFormDialog'
import { calendarKeys } from './hooks'

/**
 * A task opened from the calendar: the same form as on the board, right here, so it can be read and
 * changed without leaving the calendar. It works from the project's own task list (as the board does),
 * so ticking a subtask shows at once, and the calendar is refreshed when the form closes.
 */
export function CalendarTaskDialog({
  taskId,
  projectId,
  title,
  onClose,
}: {
  taskId: string
  projectId: string
  /** Shown while the task loads. */
  title: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const tasks = useTasks(projectId)
  const members = useMembers(projectId)
  const task = tasks.data?.find((x) => x.id === taskId)

  function close() {
    void qc.invalidateQueries({ queryKey: calendarKeys.all })
    onClose()
  }

  if (task && members.data)
    return (
      <TaskFormDialog
        projectId={projectId}
        members={members.data}
        task={task}
        subtasks={task.subtasks}
        onClose={close}
        onSaved={close}
      />
    )

  const failed = tasks.error ?? members.error
  return (
    <Modal title={title} closeLabel={t('common.close')} onClose={close}>
      {failed ? (
        <ErrorState
          message={errorMessage(t, failed)}
          onRetry={() => {
            void tasks.refetch()
            void members.refetch()
          }}
        />
      ) : tasks.isSuccess && !task ? (
        // Removed (or moved to the trash) since the calendar was loaded.
        <div className="space-y-4">
          <p className="text-muted">{t('calendar.taskGone')}</p>
          <Button type="button" variant="soft" onClick={close}>
            {t('common.close')}
          </Button>
        </div>
      ) : (
        <LoadingState label={t('tasks.loading')} />
      )}
    </Modal>
  )
}
