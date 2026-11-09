import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { restoreProject } from '../api/projects'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/context'
import { errorMessage } from '../auth/errors'
import { Avatar } from '../components/Avatar'
import { BackLink } from '../components/BackLink'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/forms'
import { Icon } from '../components/Icon'
import { Menu } from '../components/Menu'
import { RoleBadge } from '../components/RoleBadge'
import { ErrorState, LoadingState } from '../components/states'
import { useToast } from '../components/toast'
import { keys, useDeleteProject, useMembers, useProject } from '../features/projects/hooks'
import { MembersDrawer } from '../features/projects/MembersDrawer'
import { ProjectFormDialog } from '../features/projects/ProjectFormDialog'
import { TaskBoard } from '../features/tasks/TaskBoard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'

const ICON_ON_PHONE = 'max-sm:h-10 max-sm:w-10 max-sm:px-0 max-sm:py-0'

export function ProjectPage() {
  const { t, i18n } = useTranslation()
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const { request } = useAuth()
  const project = useProject(projectId)
  // The same query the board and the member list use, so this costs no extra request.
  const members = useMembers(projectId, project.isSuccess)
  const del = useDeleteProject()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  useDocumentTitle(project.data?.name ?? t('projects.title'))

  if (project.isPending) return <LoadingState label={t('common.loading')} />

  if (project.isError) {
    // 404 covers both "does not exist" and "you are not a member": the API deliberately does not say which.
    if (project.error instanceof ApiError && project.error.status === 404) {
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
      <ErrorState message={errorMessage(t, project.error)} onRetry={() => void project.refetch()} />
    )
  }

  const p = project.data
  const isOwner = p.myRole === 'owner'

  // Undo is a plain function (not a component hook) because this page is gone by the time it is clicked.
  function undo() {
    restoreProject(request, p.id)
      .then(() => {
        void qc.invalidateQueries({ queryKey: keys.lists })
        toast.show({ message: t('projects.restored', { name: p.name }) })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(t, error) }))
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <BackLink to="/">{t('projects.myProjects')}</BackLink>
        <div className="flex items-center justify-between gap-2 sm:flex-wrap sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 sm:flex-wrap">
              <h1 className="min-w-0 truncate text-2xl font-bold sm:whitespace-normal sm:break-words sm:text-3xl">
                {p.name}
              </h1>
              <span className="shrink-0">
                <RoleBadge role={p.myRole} />
              </span>
            </div>
            <p
              className="mt-0.5 truncate text-sm text-muted max-sm:hidden"
              title={p.description || undefined}
            >
              {p.description && <span>{p.description}</span>}
              {p.description && ' · '}
              <span>{t('projects.created', { date: formatDate(p.createdAt, i18n.language) })}</span>
            </p>
          </div>
          {/* On phones these become 40px icon buttons and "New task" floats over the board. */}
          <div className="flex shrink-0 items-center gap-1 sm:flex-wrap sm:gap-2">
            {members.data && (
              <Button
                type="button"
                variant="ghost"
                className={ICON_ON_PHONE}
                onClick={() => setMembersOpen(true)}
              >
                <span className="sm:hidden">
                  <Icon name="users" size={20} />
                </span>
                <span className="flex -space-x-2 max-sm:hidden" aria-hidden="true">
                  {members.data.slice(0, 3).map((m) => (
                    <span key={m.userId} className="rounded-full ring-2 ring-bg">
                      <Avatar id={m.userId} name={m.email} size={24} />
                    </span>
                  ))}
                </span>
                <span className="max-sm:sr-only">
                  {t('projects.membersButton', { count: members.data.length })}
                </span>
              </Button>
            )}
            {/* Everything in this menu is for the owner, so members do not get an empty menu. */}
            {isOwner && (
              <Menu
                label={t('projects.moreActions')}
                trigger={<Icon name="more" size={20} />}
                triggerClassName="grid h-10 w-10 place-items-center rounded-xl text-text hover:bg-primary-bg"
                items={[
                  {
                    key: 'edit',
                    label: t('projects.editTitle'),
                    icon: 'pencil',
                    onSelect: () => setEditing(true),
                  },
                  {
                    key: 'delete',
                    label: t('projects.deleteProject'),
                    icon: 'trash',
                    tone: 'danger',
                    onSelect: () => setConfirmDelete(true),
                  },
                ]}
              />
            )}
            <Button
              type="button"
              className="max-sm:fixed max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))] max-sm:right-4 max-sm:z-20 max-sm:h-12 max-sm:rounded-full max-sm:shadow-card"
              onClick={() => setCreatingTask(true)}
            >
              <Icon name="plus" />
              {t('tasks.new')}
            </Button>
          </div>
        </div>
      </header>

      <TaskBoard
        projectId={p.id}
        newTaskOpen={creatingTask}
        onNewTaskClose={() => setCreatingTask(false)}
      />

      {membersOpen && (
        <MembersDrawer projectId={p.id} isOwner={isOwner} onClose={() => setMembersOpen(false)} />
      )}

      {editing && (
        <ProjectFormDialog
          project={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            toast.show({ message: t('projects.saved') })
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t('projects.deleteTitle', { name: p.name })}
          message={t('projects.deleteMessage', { count: p.taskCount })}
          confirmLabel={t('projects.deleteConfirm')}
          pendingLabel={t('projects.deleting')}
          pending={del.isPending}
          error={del.error ? errorMessage(t, del.error) : undefined}
          onCancel={() => {
            del.reset()
            setConfirmDelete(false)
          }}
          onConfirm={() =>
            del.mutate(p.id, {
              onSuccess: () => {
                toast.show({
                  message: t('projects.movedToTrash', { name: p.name }),
                  actionLabel: t('projects.undo'),
                  onAction: undo,
                })
                navigate('/', { replace: true })
              },
            })
          }
        />
      )}
    </div>
  )
}
