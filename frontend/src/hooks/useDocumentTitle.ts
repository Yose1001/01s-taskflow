import { useEffect } from 'react'

/** Sets the browser tab title (and what screen readers announce on a page change). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · TaskFlow` : 'TaskFlow'
  }, [title])
}
