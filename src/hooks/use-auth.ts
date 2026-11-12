import { create } from 'zustand'

type AuthState = {
  status: 'checking' | 'signed-in' | 'signed-out'
  check: () => Promise<void>
  login: (key: string) => Promise<void>
  logout: () => Promise<void>
  expire: () => void
}

export const useAuth = create<AuthState>()((set) => ({
  status: 'checking',
  check: async () => {
    const response = await fetch('/api/auth/session')
    if (response.ok) {
      set({ status: 'signed-in' })
      return
    }
    if (response.status === 401) {
      set({ status: 'signed-out' })
      return
    }
    throw new Error(`/api/auth/session failed: ${response.status} ${response.statusText}`)
  },
  login: async (key) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    if (response.status === 401) {
      throw new Error('Wrong key')
    }
    if (!response.ok) {
      throw new Error(`Login failed: ${response.status} ${response.statusText}`)
    }
    set({ status: 'signed-in' })
  },
  logout: async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) {
      throw new Error(`Logout failed: ${response.status} ${response.statusText}`)
    }
    set({ status: 'signed-out' })
  },
  expire: () => set({ status: 'signed-out' }),
}))
