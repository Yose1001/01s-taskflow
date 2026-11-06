import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { GuestOnly, RequireAuth } from './auth/guards'
import { AppShell } from './components/AppShell'
import { ToastProvider } from './components/ToastProvider'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProjectPage } from './pages/ProjectPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { RegisterPage } from './pages/RegisterPage'
import { TrashPage } from './pages/TrashPage'
import { shouldRetry } from './lib/retry'
import { ThemeProvider } from './theme/ThemeProvider'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetry, refetchOnWindowFocus: false } },
})

/** The routes, separate from the providers so tests can mount them with their own router. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* Signed-out visitors only */}
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        {/* Signed-in users only */}
        <Route element={<RequireAuth />}>
          <Route index element={<ProjectsPage />} />
          <Route path="projects/trash" element={<TrashPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
        </Route>
        {/* Open to everyone: the look-and-feel showcase */}
        <Route path="/design" element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
