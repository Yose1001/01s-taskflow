import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export function NotFoundPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('notFound.title'))
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <Link to="/" className="mt-4 inline-block font-medium text-primary underline">
        {t('notFound.back')}
      </Link>
    </div>
  )
}
