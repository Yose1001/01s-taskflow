import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { errorMessage } from '../auth/errors'
import { BackLink } from '../components/BackLink'
import { Alert, Button } from '../components/forms'
import { Icon } from '../components/Icon'
import { Pagination } from '../components/Pagination'
import { EmptyState, ErrorState, LoadingState } from '../components/states'
import { useToast } from '../components/toast'
import { PAGE_SIZE, useProjects, useRestoreProject } from '../features/projects/hooks'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { daysUntil, formatDate } from '../lib/format'
import { parsePage } from '../lib/paging'

/** Deleted projects (that the person owns) that can still be restored. */
export function TrashPage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const page = parsePage(params.get('page'))
  const trashed = useProjects(page, true)
  const restore = useRestoreProject()
  useDocumentTitle(t('trash.title'))

  return (
    <div className="space-y-6">
      <p>
        <BackLink to="/">{t('projects.back')}</BackLink>
      </p>
      <div>
        <h1 className="text-3xl font-bold">{t('trash.title')}</h1>
        <p className="mt-1 text-muted">{t('trash.intro')}</p>
      </div>

      {restore.isError && <Alert>{errorMessage(t, restore.error)}</Alert>}

      {trashed.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : trashed.isError ? (
        <ErrorState
          message={errorMessage(t, trashed.error)}
          onRetry={() => void trashed.refetch()}
        />
      ) : trashed.data.total === 0 ? (
        <EmptyState title={t('trash.empty')} />
      ) : (
        <>
          <ul className="space-y-3">
            {trashed.data.items.map((p) => {
              const restoring = restore.isPending && restore.variables === p.id
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5"
                >
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-semibold">{p.name}</h2>
                    {p.purgeAt && (
                      <p className="text-sm text-muted">
                        {t('trash.deletedOn', { date: formatDate(p.purgeAt, i18n.language) })} ·{' '}
                        {t('trash.daysLeft', { days: daysUntil(p.purgeAt) })}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="soft"
                    disabled={restore.isPending}
                    aria-busy={restoring}
                    aria-label={`${t('trash.restore')}: ${p.name}`}
                    onClick={() =>
                      restore.mutate(p.id, {
                        onSuccess: () =>
                          toast.show({ message: t('projects.restored', { name: p.name }) }),
                      })
                    }
                  >
                    <Icon name="restore" />
                    {restoring ? t('trash.restoring') : t('trash.restore')}
                  </Button>
                </li>
              )
            })}
          </ul>
          <Pagination
            page={page}
            total={trashed.data.total}
            pageSize={PAGE_SIZE}
            onPage={(n) => setParams({ page: String(n) })}
          />
        </>
      )}
    </div>
  )
}
