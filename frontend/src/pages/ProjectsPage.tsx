import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { errorMessage } from '../auth/errors'
import type { Project } from '../api/types'
import { ChoiceSwitch } from '../components/ChoiceSwitch'
import { Button } from '../components/forms'
import { Icon, type IconName } from '../components/Icon'
import { Menu } from '../components/Menu'
import { Pagination } from '../components/Pagination'
import { RoleBadge } from '../components/RoleBadge'
import { ErrorState, LoadingState } from '../components/states'
import { TrashLink } from '../components/TrashLink'
import { PAGE_SIZE, useProjects } from '../features/projects/hooks'
import { ProjectFormDialog } from '../features/projects/ProjectFormDialog'
import {
  PROJECT_SORTS,
  loadProjectSort,
  loadProjectsView,
  saveProjectSort,
  saveProjectsView,
  type ProjectSort,
  type ProjectsView,
} from '../features/projects/projectsView'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate, personName } from '../lib/format'
import { lastPage, parsePage } from '../lib/paging'

/** How far along a project is: "3 of 5 done" and a bar. */
function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation()
  if (total === 0) return <p className="text-sm text-muted">{t('projects.noTasks')}</p>
  const percent = Math.round((done / total) * 100)
  const label = t('projects.progress', { done, total })
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-sm">
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

const projectPath = (p: Project) => `/projects/${encodeURIComponent(p.id)}`

function ProjectCard({ project: p }: { project: Project }) {
  const { t, i18n } = useTranslation()
  return (
    <Link
      to={projectPath(p)}
      className="block h-full rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-lg font-semibold">{p.name}</h3>
        <span className="shrink-0">
          <RoleBadge role={p.myRole} />
        </span>
      </div>
      <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-muted">
        {p.description || t('projects.noDescription')}
      </p>
      <div className="mt-3">
        <Progress done={p.doneCount} total={p.taskCount} />
      </div>
      <p className="mt-3 text-sm text-muted">
        {t('projects.created', { date: formatDate(p.createdAt, i18n.language) })}
      </p>
    </Link>
  )
}

/** One line per project on wider screens, so many projects fit on one screen. */
function ProjectRow({ project: p }: { project: Project }) {
  const { t, i18n } = useTranslation()
  return (
    <Link
      to={projectPath(p)}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-primary md:flex-nowrap"
    >
      <div className="min-w-0 flex-1 max-md:basis-full">
        <h3 className="truncate font-semibold" title={p.name}>
          {p.name}
        </h3>
        <p className="truncate text-sm text-muted" title={p.description || undefined}>
          {p.description || t('projects.noDescription')}
        </p>
      </div>
      <div className="w-48 shrink-0 max-md:w-full">
        <Progress done={p.doneCount} total={p.taskCount} />
      </div>
      <span className="shrink-0">
        <RoleBadge role={p.myRole} />
      </span>
      <span className="shrink-0 text-sm text-muted">
        {t('projects.created', { date: formatDate(p.createdAt, i18n.language) })}
      </span>
    </Link>
  )
}

/** Chooses between cards and list. On phones the buttons show only their icons. */
function ViewSwitch({
  view,
  onChange,
}: {
  view: ProjectsView
  onChange: (view: ProjectsView) => void
}) {
  const { t } = useTranslation()
  return (
    <ChoiceSwitch
      label={t('projects.viewLabel')}
      value={view}
      onChange={onChange}
      options={[
        { value: 'cards', icon: 'grid', label: t('projects.viewCards') },
        { value: 'list', icon: 'list', label: t('projects.viewList') },
      ]}
    />
  )
}

// A picture for each way of sorting the projects. The words still say it.
const PROJECT_SORT_ICON: Record<ProjectSort, IconName> = {
  newest: 'clock',
  oldest: 'clock',
  progress_high: 'progress',
  progress_low: 'progress',
}

/** Chooses the order of the list. On phones the button shows only its icon. */
function SortMenu({
  sort,
  onChange,
}: {
  sort: ProjectSort
  onChange: (sort: ProjectSort) => void
}) {
  const { t } = useTranslation()
  const current = t(`projects.sort_${sort}`)
  return (
    <Menu
      floating // on a phone its button sits near the left edge, and the menu must stay on screen
      label={t('projects.sortLabel', { sort: current })}
      trigger={
        <>
          <Icon name="sort" />
          <span className="max-sm:hidden">{current}</span>
        </>
      }
      triggerClassName="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 text-sm font-medium text-text hover:bg-primary-bg"
      items={PROJECT_SORTS.map((value) => ({
        key: value,
        icon: PROJECT_SORT_ICON[value],
        label: t(`projects.sort_${value}`),
        checked: value === sort,
        onSelect: () => onChange(value),
      }))}
    />
  )
}

/** Phones only: the order and the view of the list, in one ⋯ menu, so the row keeps to one line. */
function PhoneListOptions({
  sort,
  view,
  onSort,
  onView,
}: {
  sort: ProjectSort
  view: ProjectsView
  onSort: (sort: ProjectSort) => void
  onView: (view: ProjectsView) => void
}) {
  const { t } = useTranslation()
  const sortHeading = t('projects.sortHeading')
  const viewHeading = t('projects.viewLabel')
  return (
    <div className="sm:hidden">
      <Menu
        floating
        label={t('projects.listOptions')}
        trigger={<Icon name="more" size={20} />}
        triggerClassName="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface text-text hover:bg-primary-bg"
        items={[
          ...PROJECT_SORTS.map((value, index) => ({
            key: `sort-${value}`,
            ...(index === 0 && { heading: sortHeading }),
            icon: PROJECT_SORT_ICON[value],
            label: t(`projects.sort_${value}`),
            ariaLabel: `${sortHeading}: ${t(`projects.sort_${value}`)}`,
            checked: value === sort,
            onSelect: () => onSort(value),
          })),
          ...(['cards', 'list'] as const).map((value, index) => ({
            key: `view-${value}`,
            ...(index === 0 && { heading: viewHeading }),
            icon: value === 'cards' ? ('grid' as const) : ('list' as const),
            label: t(value === 'cards' ? 'projects.viewCards' : 'projects.viewList'),
            ariaLabel: `${viewHeading}: ${t(value === 'cards' ? 'projects.viewCards' : 'projects.viewList')}`,
            checked: value === view,
            onSelect: () => onView(value),
          })),
        ]}
      />
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
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = parsePage(params.get('page'))
  const [sort, setSort] = useState(loadProjectSort)
  // The newest first is the server's own order, so the address stays plain unless the person chose another.
  const projects = useProjects(page, false, sort === 'newest' ? undefined : sort)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState(loadProjectsView)
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
        <h1 className="break-words text-2xl font-bold sm:text-3xl">
          {t('dashboard.hello', { name: personName(user) })}
        </h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('projects.title')}</h2>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          {projects.data && projects.data.total > 0 && (
            <div className="flex items-center gap-2 max-sm:hidden">
              <SortMenu
                sort={sort}
                onChange={(next) => {
                  setSort(next)
                  saveProjectSort(next)
                  setParams({}) // a new order starts from the first page
                }}
              />
              <ViewSwitch
                view={view}
                onChange={(next) => {
                  setView(next)
                  saveProjectsView(next)
                }}
              />
            </div>
          )}
          <TrashLink to="/projects/trash" label={t('projects.trash')} ghostOnPhone />
          <div className="flex items-center gap-2 max-sm:ml-auto">
            {projects.data && projects.data.total > 0 && (
              <PhoneListOptions
                sort={sort}
                view={view}
                onSort={(next) => {
                  setSort(next)
                  saveProjectSort(next)
                  setParams({})
                }}
                onView={(next) => {
                  setView(next)
                  saveProjectsView(next)
                }}
              />
            )}
            {/* A new person has one big button in the welcome panel instead: one primary button per page.
                Waiting for the list means the button never flashes up and disappears again. */}
            {projects.data && projects.data.total > 0 && (
              <Button type="button" onClick={() => setCreating(true)}>
                <Icon name="plus" />
                {t('projects.new')}
              </Button>
            )}
          </div>
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
            data-view={view}
            className={view === 'list' ? 'space-y-2' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'}
          >
            {projects.data.items.map((p) => (
              <li key={p.id}>
                {view === 'list' ? <ProjectRow project={p} /> : <ProjectCard project={p} />}
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
