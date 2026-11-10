import '@/styles/index.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'waka',
  icons: { icon: 'data:,' },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  )
}
