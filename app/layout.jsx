export const metadata = {
  title: 'Sakura Nails Hamburg – Termin buchen',
  description: 'Buche deinen Nail-Termin bei Sakura Nails Hamburg',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  )
}
