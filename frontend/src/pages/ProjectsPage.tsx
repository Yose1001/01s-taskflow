import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { errorMessage } from '../auth/errors'
import { Button } from '../components/forms'
import { Pagination } from '../components/Pagination'
import { RoleBadge } from '../components/RoleBadge'
import { ErrorState, LoadingState } from '../components/states'
import { PAGE_SIZE, useProjects } from '../features/projects/hooks'
import { ProjectFormDialog } from '../features/projects/ProjectFormDialog'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate } from '../lib/format'
import { lastPage, parsePage } from '../lib/paging'

/** How far along a project is: "3 of 5 done" and a bar. */
function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation()
  if (total === 0) return <p className="mt-3 text-sm text-muted">{t('projects.noTasks')}</p>
  const percent = Math.round((done / total) * 100)
  const label = t('projects.progress', { done, total })
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-primary-fg" aria-hidden="true">
          {percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** First visit (no projects yet): what TaskFlow is for and how to start, in three steps. */
function Welcome({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  const steps = [t('welcome.step1'), t('welcome.step2'), t('welcome.step3')]
  return (
    <section
      aria-labelledby="welcome-title"
      className="rounded-2xl border border-border bg-surface p-6 sm:p-8"
    >
      <h2 id="welcome-title" className="text-2xl font-bold">
        {t('welcome.title')}
      </h2>
      <p className="mt-1 text-muted">{t('projects.empty')}</p>
      <ol className="mt-6 grid gap-4 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 rounded-xl bg-surface-2 p-4">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-bg font-bold text-primary-fg"
            >
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <Button type="button" onClick={onCreate}>
          {t('welcome.cta')}
        </Button>
      </div>
    </section>
  )
}

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
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('projects.title')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/projects/trash" className="font-medium text-primary underline">
            {t('projects.trash')}
          </Link>
          {/* A new person has one big button in the welcome panel instead: one primary button per page.
              Waiting for the list means the button never flashes up and disappears again. */}
          {projects.data && projects.data.total > 0 && (
            <Button type="button" onClick={() => setCreating(true)}>
              {t('projects.new')}
            </Button>
          )}
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
        <Welcome onCreate={() => setCreating(true)} />
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
                  <Progress done={p.doneCount} total={p.taskCount} />
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
