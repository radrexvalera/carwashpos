// Routes are code-split and most pages fetch their own data after mounting, so the tour's target
// element usually isn't in the DOM the instant navigation happens -- poll via MutationObserver
// instead of a fixed delay. Resolves null on timeout rather than hanging forever (the target
// might genuinely be missing, e.g. a page failed to load), and the tour falls back to a centered
// popover in that case instead of getting stuck.
export function waitForElement(selector: string, timeoutMs = 8000): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector)
    if (existing) {
      resolve(existing)
      return
    }

    const timer = window.setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeoutMs)

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        observer.disconnect()
        window.clearTimeout(timer)
        resolve(el)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}
