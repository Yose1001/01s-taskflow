import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { errorMessage } from '../auth/errors'
import { Button } from '../components/forms'
import { Pagination } from '../components/Pagination'
import { RoleBadge } from '../components/RoleBadge'
import { EmptyState, ErrorState, LoadingState } from '../components/states'
import { PAGE_SIZE, useProjects } from '../features/projects/hooks'
import { ProjectFormDialog } from '../features/projects/ProjectFormDialog'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'
import { lastPage, parsePage } from '../lib/paging'

/** The page after signing in: a greeting and the person's projects. */
export function ProjectsPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = parsePage(params.get('page'))
  const projects = useProjects(page)
  const [creating, setCreating] = useState(false)
  useDocumentTitle(t('projects.title'))

  // A page number past the end (for example after deleting the last project on it) goes to the last real page.
  const total = projects.data?.total ?? 0
  const empty = projects.data !== undefined && projects.data.items.length === 0
  useEffect(() => {
    if (empty && total > 0 && page > 1)
      setParams({ page: String(lastPage(total, PAGE_SIZE)) }, { replace: true })
  }, [empty, total, page, setParams])

  if (!user) return null
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('dashboard.hello', { name: user.displayName })}</h1>
        <p className="mt-1 text-muted">{user.email}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('projects.title')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/projects/trash" className="font-medium text-primary underline">
            {t('projects.trash')}
          </Link>
          <Button type="button" onClick={() => setCreating(true)}>
            {t('projects.new')}
          </Button>
        </div>
      </div>

      {projects.isPending ? (
        <LoadingState label={t('projects.loading')} />
      ) : projects.isError ? (
        <ErrorState
          message={errorMessage(t, projects.error)}
          onRetry={() => void projects.refetch()}
        />
      ) : projects.data.total === 0 ? (
        <EmptyState title={t('projects.empty')} hint={t('projects.emptyHint')}>
          <Button type="button" onClick={() => setCreating(true)}>
            {t('projects.new')}
          </Button>
        </EmptyState>
      ) : (
        <>
          <ul
            aria-busy={projects.isPlaceholderData}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {projects.data.items.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/projects/${encodeURIComponent(p.id)}`}
                  className="block h-full rounded-2xl border border-border bg-surface p-5 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="break-words text-lg font-semibold">{p.name}</h3>
                    <RoleBadge role={p.myRole} />
                  </div>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-muted">
                    {p.description || t('projects.noDescription')}
                  </p>
                  <p className="mt-3 text-sm text-muted">
                    {t('projects.created', { date: formatDate(p.createdAt, i18n.language) })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            total={projects.data.total}
            pageSize={PAGE_SIZE}
            onPage={(p) => setParams({ page: String(p) })}
          />
        </>
      )}

      {creating && (
        <ProjectFormDialog
          onClose={() => setCreating(false)}
          onSaved={(created) => {
            setCreating(false)
            navigate(`/projects/${encodeURIComponent(created.id)}`)
          }}
        />
      )}
    </div>
  )
}
