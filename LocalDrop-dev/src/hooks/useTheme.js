import { useState, useEffect } from 'react'

export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('ledgix_theme') || 'dark'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('ledgix_theme', theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  // Returns which logo_name PNG to use based on current theme
  // dark mode  → logo_name_light.png  (light-coloured text, visible on dark bg)
  // light mode → logo_name_dark.png   (dark-coloured text, visible on light bg)
  const logoName = theme === 'dark' ? '/logo_name_light.png' : '/logo_name_dark.png'

  return { theme, toggle, logoName }
}
