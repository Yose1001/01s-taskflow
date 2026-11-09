import { useEffect } from 'react'

const APP_NAME = 'TaskFlow'

/**
 * Sets the browser tab title (and what screen readers announce on a page change). Leaving the page puts the
 * app's name back, so a project's name never stays in the tab after logging out, even on a page without a title.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
    return () => {
      document.title = APP_NAME
    }
  }, [title])
}
