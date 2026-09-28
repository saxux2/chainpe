'use client'

import { useEffect } from 'react'

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      const saved = localStorage.getItem('chainpe-theme')
      if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
      } else if (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark')
      }
    } catch {
      // localStorage may be blocked
    }
  }, [])

  return <>{children}</>
}
