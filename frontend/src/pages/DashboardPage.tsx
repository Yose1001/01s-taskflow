import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/context'

/** The page after signing in. The project list will replace the "coming soon" card. */
export function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  if (!user) return null
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('dashboard.hello', { name: user.displayName })}</h1>
        <p className="mt-1 text-muted">{user.email}</p>
      </div>
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">{t('dashboard.projectsTitle')}</h2>
        <p className="mt-1 text-muted">{t('dashboard.comingSoon')}</p>
      </section>
    </div>
  )
}
