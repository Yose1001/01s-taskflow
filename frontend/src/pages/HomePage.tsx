import { useTranslation } from 'react-i18next'
import {
  PriorityBadge,
  StatusBadge,
  type TaskPriority,
  type TaskStatus,
} from '../components/StatusBadge'

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high']

// Names are token names from index.css, shown as swatches so the whole palette is visible at a glance.
const SWATCHES = [
  { name: 'primary', classes: 'bg-primary text-on-primary' },
  { name: 'lavender', classes: 'bg-primary-bg text-primary-fg' },
  { name: 'pink', classes: 'bg-pink-bg text-pink-fg' },
  { name: 'mint', classes: 'bg-mint-bg text-mint-fg' },
  { name: 'sky', classes: 'bg-sky-bg text-sky-fg' },
  { name: 'peach', classes: 'bg-peach-bg text-peach-fg' },
  { name: 'lemon', classes: 'bg-lemon-bg text-lemon-fg' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  )
}

/** A showcase of the look and feel. It will be replaced by the real home page (project list) later. */
export function HomePage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('home.title')}</h1>
        <p className="mt-1 text-muted">{t('app.tagline')}</p>
        <p className="mt-3 max-w-2xl">{t('home.intro')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title={t('home.paletteTitle')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SWATCHES.map((s) => (
              <div
                key={s.name}
                className={`rounded-xl px-3 py-4 text-center text-sm font-medium ${s.classes}`}
              >
                {s.name}
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('home.statusTitle')}>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-muted">
            {t('home.priorityTitle')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => (
              <PriorityBadge key={p} priority={p} />
            ))}
          </div>
        </Section>

        <Section title={t('home.buttonsTitle')}>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-xl bg-primary px-4 py-2 font-medium text-on-primary hover:opacity-90"
            >
              {t('home.primaryButton')}
            </button>
            <button
              type="button"
              className="rounded-xl border border-border bg-surface-2 px-4 py-2 font-medium text-text hover:bg-primary-bg"
            >
              {t('home.secondaryButton')}
            </button>
          </div>
          <p role="alert" className="mt-4 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            {t('home.errorSample')}
          </p>
        </Section>

        <Section title={t('status.in_progress')}>
          <article className="rounded-xl border border-border bg-surface-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{t('home.sampleTaskTitle')}</h3>
              <PriorityBadge priority="high" />
            </div>
            <p className="mt-1 text-sm text-muted">{t('home.sampleTaskMeta')}</p>
            <div className="mt-3">
              <StatusBadge status="in_progress" />
            </div>
          </article>
        </Section>
      </div>
    </div>
  )
}
