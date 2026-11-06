import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext } from './context'
import { applyTheme, initialTheme, storeTheme, type Theme } from './theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
