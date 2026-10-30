import * as React from 'react'

type ErrorBoundaryProps = {
  fallback: React.ReactNode
  children: React.ReactNode
}

export function ErrorBoundary({ fallback, children }: ErrorBoundaryProps) {
  const [hasError, setHasError] = React.useState(false)

  React.useEffect(() => {
    setHasError(false)
  }, [])

  if (hasError) {
    if (fallback) {
      return React.createElement('div', { className: 'p-6 text-center text-muted' }, fallback)
    }
    return null
  }

  return children
}