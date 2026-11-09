import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { restoreProject } from '../api/projects'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/context'
import { errorMessage } from '../auth/errors'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/forms'
import { Icon } from '../components/Icon'
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
          {t('projects.back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-bold sm:text-3xl">{p.name}</h1>
              <RoleBadge role={p.myRole} />
            </div>
            {p.description && (
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-muted">
                {p.description}
              </p>
            )}
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
              <span>{t('projects.created', { date: formatDate(p.createdAt, i18n.language) })}</span>
              {members.data && (
                <a href="#members" className="font-medium text-primary underline">
                  {t('projects.membersLink', { count: members.data.length })}
                </a>
              )}
            </p>
          </div>
          {isOwner && (
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="soft" onClick={() => setEditing(true)}>
                <Icon name="pencil" />
                {t('projects.edit')}
              </Button>
              <Button type="button" variant="soft" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" />
                {t('projects.delete')}
              </Button>
            </div>
          )}
        </div>
      </header>

      <TaskBoard projectId={p.id} />

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
