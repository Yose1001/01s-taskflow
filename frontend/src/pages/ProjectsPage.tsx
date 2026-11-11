import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { errorMessage } from '../auth/errors'
import type { Project } from '../api/types'
import { Avatar } from '../components/Avatar'
import { ChoiceSwitch } from '../components/ChoiceSwitch'
import { Button } from '../components/forms'
import { Icon, type IconName } from '../components/Icon'
import { Menu, type MenuItem } from '../components/Menu'
import { Pagination } from '../components/Pagination'
import { PeopleRow } from '../components/PeopleRow'
import { RoleBadge } from '../components/RoleBadge'
import { ErrorState, LoadingState } from '../components/states'
import { TrashLink } from '../components/TrashLink'
import { usePeople } from '../features/calendar/hooks'
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

/** Who is in a project: names and pictures on a card, or just the pictures in a list row. */
function ProjectPeople({ project: p, compact = false }: { project: Project; compact?: boolean }) {
  const { t } = useTranslation()
  const people = p.members.map((m) => ({ id: m.userId, name: personName(m) }))
  if (people.length === 0) return null
  const others = p.memberCount - people.length
  return (
    <PeopleRow
      people={people}
      word={t('projects.membersWord')}
      describe={(names) => t('projects.membersTitle', { names })}
      more={others > 0 ? t('projects.moreMembers', { count: others }) : undefined}
      compact={compact}
      className={compact ? 'shrink-0' : 'mt-3'}
    />
  )
}

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
      <ProjectPeople project={p} />
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
      <ProjectPeople project={p} compact />
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
  updated: 'pencil',
  name: 'az',
  progress_high: 'progress',
  progress_low: 'progress',
}

/**
 * Which projects show: all of them, or those where any of the ticked people (me among them) has a task,
 * like the person filter on the board. The menu stays open while people are ticked.
 */
function ProjectsFilterMenu({
  chosen,
  onChange,
}: {
  chosen: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const people = usePeople().data?.items ?? []
  // The ticks live in the address, which the page reads a moment later. A second tick in that moment
  // must build on the first, not on what the page still shows, or the first would be lost.
  const latest = useRef<string[] | null>(null)
  const shown = chosen.join(',')
  useEffect(() => {
    latest.current = null // the page has caught up
  }, [shown])
  if (!user) return null
  const heading = t('projects.filterHeading')
  const choose = (next: string[]) => {
    latest.current = next
    onChange(next)
  }
  const toggle = (id: string) => {
    const now = latest.current ?? chosen
    choose(now.includes(id) ? now.filter((x) => x !== id) : [...now, id])
  }
  const words = (id: string) => {
    if (id === user.id) return t('projects.filterMine')
    const person = people.find((p) => p.userId === id)
    return t('projects.filterOf', { name: person ? personName(person) : '…' })
  }
  // In the menu's order: "Where I have tasks", then "Where Bob has tasks +1" for more.
  const order = [user.id, ...people.map((p) => p.userId)]
  const ticked = [...chosen].sort(
    (a, b) =>
      (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1),
  )
  const choice =
    ticked.length === 0
      ? t('projects.filterAll')
      : ticked.length === 1
        ? words(ticked[0]!)
        : `${words(ticked[0]!)} +${ticked.length - 1}`
  const label = t('projects.filterLabel', { choice })
  const items: MenuItem[] = [
    {
      key: 'all',
      heading,
      icon: 'grid',
      label: t('projects.filterAll'),
      ariaLabel: `${heading}: ${t('projects.filterAll')}`,
      checked: chosen.length === 0,
      onSelect: () => choose([]),
    },
    {
      key: user.id,
      leading: <Avatar id={user.id} name={personName(user)} size={20} />,
      label: t('projects.filterMine'),
      ariaLabel: `${heading}: ${t('projects.filterMine')}`,
      checked: chosen.includes(user.id),
      onSelect: () => toggle(user.id),
    },
    ...people.map((p) => ({
      key: p.userId,
      leading: <Avatar id={p.userId} name={personName(p)} size={20} />,
      label: personName(p),
      // Two people may share a name: the email tells them apart for a screen reader.
      ariaLabel: `${heading}: ${t('projects.filterOf', { name: personName(p) })} · ${p.email}`,
      checked: chosen.includes(p.userId),
      onSelect: () => toggle(p.userId),
    })),
  ]
  return (
    <Menu
      multiple
      floating // on a phone the button sits near the left edge, and the menu must stay on screen
      label={label}
      trigger={
        <>
          <Icon name="users" />
          <span className="max-w-48 truncate max-sm:hidden">{label}</span>
        </>
      }
      triggerClassName="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 text-sm font-medium text-text hover:bg-primary-bg"
      items={items}
    />
  )
}

/** Nothing matches the chosen people: say so, and offer every project again. */
function FilterEmpty({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 text-center">
      <p className="text-muted">{t('projects.filterEmpty')}</p>
      <Button type="button" variant="soft" className="mt-4" onClick={onClear}>
        {t('projects.filterClear')}
      </Button>
    </div>
  )
}

// A user id, as the address may carry one: anything else is ignored.
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// As many people as the API takes at once.
const MAX_PEOPLE = 50

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
  // Whose projects: everyone's (empty), or those of the people in the address (?person=<id>,<id>).
  // Anything that is not a user id is left out, and so is a second copy of one.
  const chosen = [
    ...new Set((params.get('person') ?? '').split(',').filter((id) => USER_ID.test(id))),
  ].slice(0, MAX_PEOPLE)
  const person = chosen.join(',')
  // The newest first is the server's own order, so the address stays plain unless the person chose another.
  const projects = useProjects(
    page,
    false,
    sort === 'newest' ? undefined : sort,
    person || undefined,
  )
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState(loadProjectsView)
  useDocumentTitle(t('projects.title'))

  // A page number past the end (for example after deleting the last project on it) goes to the last real page.
  const total = projects.data?.total ?? 0
  const empty = projects.data !== undefined && projects.data.items.length === 0
  useEffect(() => {
    if (empty && total > 0 && page > 1) {
      const last = String(lastPage(total, PAGE_SIZE))
      setParams(person ? { person, page: last } : { page: last }, { replace: true })
    }
  }, [empty, total, page, person, setParams])
  // The controls stay while a person is chosen, even when none of their projects is left.
  const listed = projects.data !== undefined && (projects.data.total > 0 || person !== '')

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
          {listed && (
            <ProjectsFilterMenu
              chosen={chosen}
              onChange={(next) => setParams(next.length > 0 ? { person: next.join(',') } : {})}
            />
          )}
          {listed && (
            <div className="flex items-center gap-2 max-sm:hidden">
              <SortMenu
                sort={sort}
                onChange={(next) => {
                  setSort(next)
                  saveProjectSort(next)
                  setParams(person ? { person } : {}) // a new order starts from the first page
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
          <TrashLink
            to="/projects/trash"
            label={t('projects.trash')}
            iconOnlyOnPhone
            ghostOnPhone
          />
          <div className="flex items-center gap-2 max-sm:ml-auto">
            {listed && (
              <PhoneListOptions
                sort={sort}
                view={view}
                onSort={(next) => {
                  setSort(next)
                  saveProjectSort(next)
                  setParams(person ? { person } : {})
                }}
                onView={(next) => {
                  setView(next)
                  saveProjectsView(next)
                }}
              />
            )}
            {/* A new person has one big button in the welcome panel instead: one primary button per page.
                Waiting for the list means the button never flashes up and disappears again. */}
            {listed && (
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
        person ? (
          <FilterEmpty onClear={() => setParams({})} />
        ) : (
          <Welcome onCreate={() => setCreating(true)} />
        )
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
            onPage={(p) => setParams(person ? { person, page: String(p) } : { page: String(p) })}
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
