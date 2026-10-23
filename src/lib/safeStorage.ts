// Safari throws (SecurityError) on localStorage access under several real conditions -- Private
// Browsing, Intelligent Tracking Prevention's storage partitioning, low device storage, some
// restricted in-app webview contexts. Every direct localStorage call in this app should go
// through here instead of the raw API, so a throw degrades to "treat as unavailable" rather than
// crashing whatever component happens to touch it -- several call sites do this during render
// (useState initializers), where an uncaught throw takes down the whole page via the error
// boundary, not just the one feature that wanted the cached value.
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore -- the value just won't persist across sessions. Not worth surfacing to the user.
  }
}
