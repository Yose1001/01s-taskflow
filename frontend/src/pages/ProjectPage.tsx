import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { restoreProject } from '../api/projects'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/context'
import { errorMessage } from '../auth/errors'
import { Avatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/forms'
import { Icon } from '../components/Icon'
import { Menu } from '../components/Menu'
import { RoleBadge } from '../components/RoleBadge'
import { ErrorState, LoadingState } from '../components/states'
import { useToast } from '../components/toast'
import { keys, useDeleteProject, useMembers, useProject } from '../features/projects/hooks'
import { MembersSection } from '../features/projects/MembersSection'
import { ProjectFormDialog } from '../features/projects/ProjectFormDialog'
import { TaskBoard } from '../features/tasks/TaskBoard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'

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
  useDocumentTitle(project.data?.name ?? t('projects.title'))

  if (project.isPending) return <LoadingState label={t('common.loading')} />

  if (project.isError) {
    // 404 covers both "does not exist" and "you are not a member": the API deliberately does not say which.
    if (project.error instanceof ApiError && project.error.status === 404) {
      return (
        <div className="py-12 text-center">
          <h1 className="text-2xl font-bold">{t('projects.notFoundTitle')}</h1>
          <p className="mt-2 text-muted">{t('projects.notFoundText')}</p>
          <Link to="/" className="mt-4 inline-block font-medium text-primary underline">
            {t('projects.back')}
          </Link>
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
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline"
        >
          <Icon name="arrow-left" />
          {t('projects.myProjects')}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-bold sm:text-3xl">{p.name}</h1>
              <RoleBadge role={p.myRole} />
            </div>
            <p className="mt-0.5 truncate text-sm text-muted" title={p.description || undefined}>
              {p.description && <span>{p.description}</span>}
              {p.description && ' · '}
              <span>{t('projects.created', { date: formatDate(p.createdAt, i18n.language) })}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {members.data && (
              <a
                href="#members"
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 font-medium text-text hover:bg-primary-bg"
              >
                <span className="flex -space-x-2" aria-hidden="true">
                  {members.data.slice(0, 3).map((m) => (
                    <span key={m.userId} className="rounded-full ring-2 ring-bg">
                      <Avatar id={m.userId} name={m.displayName} size={24} />
                    </span>
                  ))}
                </span>
                {t('projects.membersButton', { count: members.data.length })}
              </a>
            )}
            {isOwner && (
              <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
                <Icon name="pencil" />
                {t('projects.edit')}
              </Button>
            )}
            <Menu
              label={t('projects.moreActions')}
              trigger={<Icon name="more" size={20} />}
              triggerClassName="grid h-10 w-10 place-items-center rounded-xl text-text hover:bg-primary-bg"
              items={[
                {
                  key: 'trash',
                  label: t('tasks.trashTitle'),
                  icon: 'trash',
                  onSelect: () => navigate(`/projects/${encodeURIComponent(p.id)}/trash`),
                },
                ...(isOwner
                  ? [
                      {
                        key: 'delete',
                        label: t('projects.deleteProject'),
                        icon: 'trash' as const,
                        danger: true,
                        onSelect: () => setConfirmDelete(true),
                      },
                    ]
                  : []),
              ]}
            />
            <Button type="button" onClick={() => setCreatingTask(true)}>
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

      <MembersSection projectId={p.id} isOwner={isOwner} />

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
