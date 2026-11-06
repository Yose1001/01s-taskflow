import { useTranslation } from 'react-i18next'
import { Button } from './forms'

interface Props {
  page: number
  total: number
  pageSize: number
  onPage: (page: number) => void
}

/** Previous / Next with "Page X of Y". Renders nothing when everything fits on one page. */
export function Pagination({ page, total, pageSize, onPage }: Props) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <nav
      aria-label={t('common.pagination')}
      className="mt-6 flex items-center justify-center gap-3"
    >
      <Button
        type="button"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t('common.previous')}
      </Button>
      <span className="text-sm text-muted">{t('common.pageOf', { page, pages })}</span>
      <Button
        type="button"
        variant="secondary"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {t('common.next')}
      </Button>
    </nav>
  )
}
