'use client'

import dynamic from 'next/dynamic'

const App = dynamic(() => import('@/app/app').then((module) => module.App), { ssr: false })

export function Dashboard() {
  return <App />
}
