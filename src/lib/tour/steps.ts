export interface TourStepConfig {
  route: string
  elementId: string | null
  title: string
  description: string
}

// Each step maps to one page -- the tour navigates there, waits for the target element to mount
// (routes are code-split and most pages fetch data on load), then highlights it. elementId: null
// shows a plain centered popover instead of highlighting anything (used for the welcome/finish
// bookends).
export const TOUR_STEPS: TourStepConfig[] = [
  {
    route: '/',
    elementId: null,
    title: "Let's set up your shop",
    description: "A few quick steps to get your POS ready for your first real job. You can skip this anytime and replay it later from the help button in the header.",
  },
  {
    route: '/admin/settings',
    elementId: 'tour-settings-business',
    title: 'Your business info',
    description: 'Set your business name, address, and receipt details here. This shows up on every printed receipt and payslip.',
  },
  {
    route: '/admin/service-categories',
    elementId: 'tour-add-category',
    title: 'Group your services',
    description: 'Create categories like Wash, Detailing, or Add-ons. Flag the actual carwash ones as "Counts as carwash" — that\'s what decides whether a job earns the 30% or 40% commission rate.',
  },
  {
    route: '/admin/services',
    elementId: 'tour-add-service',
    title: 'Add your services',
    description: 'Add each service you offer and put it in a category. Set its price per vehicle size afterward on the Pricing page.',
  },
  {
    route: '/admin/bays',
    elementId: 'tour-add-bay',
    title: 'Add your wash bays',
    description: 'These show up on the Job Queue board so everyone can see which bay each car is sitting in.',
  },
  {
    route: '/admin/employees',
    elementId: 'tour-add-employee',
    title: 'Add your crew',
    description: 'Add everyone who works here — even attendants who never log in. Toggle "Create a login" to give a cashier, manager, or admin a real account to sign in with.',
  },
  {
    route: '/admin/commission-rules',
    elementId: 'tour-commission-policy',
    title: "Set your crew's commission split",
    description: 'A carwash-only job pays one rate, a job with any other service pays the other — split evenly among whoever is assigned to it.',
  },
  {
    route: '/jobs',
    elementId: 'tour-job-queue',
    title: 'Your Job Queue',
    description: 'This is where your crew tracks every car in real time, from Waiting to On Going to Ready for Release. Works offline too.',
  },
  {
    route: '/register',
    elementId: 'tour-register-vehicle',
    title: 'Create your first job',
    description: 'Search or add the vehicle, pick its services, assign crew, and send it to a bay — this is where every job starts.',
  },
  {
    route: '/',
    elementId: null,
    title: "You're all set!",
    description: 'That covers the essentials. Replay this tour anytime from the help button (?) in the header.',
  },
]
