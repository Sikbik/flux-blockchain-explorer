import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "FluxIndexer Dashboard",
  description: "Real-time monitoring for Flux Blockchain Indexer",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  )
}
