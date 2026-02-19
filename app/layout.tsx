import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mappedin Camera Placement Tool',
  description: 'Interactive tool for placing cameras on Mappedin maps',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}