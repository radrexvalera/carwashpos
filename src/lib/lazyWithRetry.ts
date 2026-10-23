import { lazy, type ComponentType } from 'react'

const RELOAD_FLAG = 'chunk-reload-attempted'

// Every route is a separate JS chunk (see App.tsx's comment on why), fetched fresh the first time
// a tab navigates there. On a flaky/dropped connection -- the normal state of a shop-floor tablet
// on wifi -- that fetch can fail outright, and React has no built-in retry for it: the rejection
// propagates as a render error, caught by the nearest ErrorBoundary as a generic "Something went
// wrong" with no way back except a manual reload. The same failure also happens, less obviously,
// right after a fresh deploy: a tab that's been open since before the deploy still references the
// OLD chunk hashes, which the CDN no longer serves.
//
// This retries the import a couple of times with a short delay first (recovers a brief blip
// silently, no visible error at all). If it still fails, it reloads the page ONCE automatically
// instead of surfacing the error boundary -- a fresh index.html picks up the current asset
// manifest, which resolves the stale-deploy case immediately. The sessionStorage flag stops that
// from looping if the real cause is a genuine, ongoing outage; after one attempt it gives up and
// lets the error boundary show its normal message.
export function lazyWithRetry<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>, retries = 2, delayMs = 1000) {
  return lazy(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const mod = await factory()
        sessionStorage.removeItem(RELOAD_FLAG)
        return mod
      } catch (err) {
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }

        let alreadyReloaded = false
        try {
          alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === 'true'
        } catch {
          // Private browsing / storage disabled -- fall through to throwing normally below.
        }

        if (!alreadyReloaded) {
          try {
            sessionStorage.setItem(RELOAD_FLAG, 'true')
          } catch {
            // Ignore -- worst case this reloads more than once, still better than white-screening.
          }
          window.location.reload()
          // The reload is already in flight; never resolve so React doesn't render anything with
          // this rejected module in the meantime.
          return new Promise<{ default: T }>(() => {})
        }

        try {
          sessionStorage.removeItem(RELOAD_FLAG)
        } catch {
          // Ignore.
        }
        throw err
      }
    }
    // Unreachable -- the loop above always either returns or throws.
    throw new Error('Failed to load module')
  })
}
