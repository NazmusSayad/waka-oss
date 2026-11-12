'use client'

import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { Login } from '@/features/login'
import { useAuth } from '@/hooks/use-auth'

const App = dynamic(() => import('@/app/app').then((module) => module.App), { ssr: false })

export function Dashboard() {
  const status = useAuth((state) => state.status)
  const check = useAuth((state) => state.check)

  useEffect(() => {
    void check()
  }, [check])

  if (status === 'checking') {
    return null
  }
  if (status === 'signed-out') {
    return <Login />
  }
  return <App />
}
