import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthProvider'
import { ToastProvider } from '../components/ToastProvider'
import { shouldRetry } from '../lib/retry'
import { ThemeProvider } from '../theme/ThemeProvider'

/** Renders UI with the same providers as the real app (data fetching, theme, sign-in, toasts, router). */
export function renderApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  // Same retry rule as the real app, but no waiting between attempts so tests stay fast.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry, retryDelay: 0 } },
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
}
