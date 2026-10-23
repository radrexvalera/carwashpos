import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

// No error boundary existed anywhere in this app -- an uncaught render error white-screened the
// whole thing with no way to recover short of knowing to hit browser-refresh. This matters a lot
// for a shop-floor tool: a cashier mid-transaction needs a visible way out, not a blank page.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled render error:', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-muted-foreground">
            The app hit an unexpected error. Your data is safe — any offline changes are still queued and will
            sync once you reload. If your connection is weak or intermittent, that's the most likely cause —
            try again once it's steadier.
          </p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )
    }

    return this.props.children
  }
}
