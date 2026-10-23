import { createContext, useContext, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { TOUR_STEPS } from './steps'
import { waitForElement } from './waitForElement'

interface TourContextValue {
  startTour: () => void
}

const TourContext = createContext<TourContextValue | null>(null)

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within TourProvider')
  return ctx
}

// Deliberately NOT using driver.js's own multi-step `steps` array -- that engine assumes every
// step's element already exists in the DOM up front. This tour spans many lazy-loaded routes, so
// each step has to navigate, wait for its target to mount, THEN highlight -- driven manually here
// via driver.js's single-step highlight() API instead.
export function TourProvider({ children, onFinish }: { children: ReactNode; onFinish: () => void }) {
  const navigate = useNavigate()
  const driverRef = useRef<Driver | null>(null)

  async function goToStep(index: number, driverObj: Driver) {
    if (index < 0) return
    if (index >= TOUR_STEPS.length) {
      driverObj.destroy()
      onFinish()
      return
    }

    const step = TOUR_STEPS[index]
    navigate(step.route)
    const element = step.elementId ? await waitForElement(`#${step.elementId}`) : null
    const isLast = index === TOUR_STEPS.length - 1

    driverObj.highlight({
      element: element ?? undefined,
      popover: {
        title: `${step.title}`,
        description: step.description,
        showButtons: index === 0 ? ['next', 'close'] : ['next', 'previous', 'close'],
        nextBtnText: isLast ? 'Finish' : 'Next',
        onNextClick: () => goToStep(index + 1, driverObj),
        onPrevClick: () => goToStep(index - 1, driverObj),
        onCloseClick: () => {
          driverObj.destroy()
          onFinish()
        },
      },
    })
  }

  function startTour() {
    driverRef.current?.destroy()
    const driverObj = driver({ showProgress: false, allowClose: true, overlayOpacity: 0.6 })
    driverRef.current = driverObj
    goToStep(0, driverObj)
  }

  return <TourContext.Provider value={{ startTour }}>{children}</TourContext.Provider>
}
