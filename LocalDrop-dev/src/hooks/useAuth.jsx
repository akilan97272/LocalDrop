import { createContext, useContext, useState, useEffect } from 'react'
import { login as apiLogin, getMe } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('ledgix_user')
    return stored ? JSON.parse(stored) : null
  })
  const [loading, setLoading] = useState(!localStorage.getItem('access_token') ? false : true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token && !user) {
      getMe()
        .then((r) => { setUser(r.data); localStorage.setItem('ledgix_user', JSON.stringify(r.data)) })
        .catch(() => { localStorage.removeItem('access_token'); localStorage.removeItem('ledgix_user') })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (username, password) => {
    const { data } = await apiLogin({ username, password })
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('ledgix_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }

  const logout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('ledgix_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
