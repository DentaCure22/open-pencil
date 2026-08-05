export type SmylrProductionPageGroup = 'Clinical' | 'Front Desk' | 'Operations' | 'System'

export type SmylrProductionPage = {
  group: SmylrProductionPageGroup
  id: string
  label: string
  route: string
}

export const SMYLR_PRODUCTION_PAGES: SmylrProductionPage[] = [
  {
    group: 'Clinical',
    id: 'dental-chart',
    label: 'Dental Chart',
    route: '/dental-chart'
  },
  {
    group: 'Clinical',
    id: 'health-chart',
    label: 'Health Chart',
    route: '/health-chart'
  },
  {
    group: 'Clinical',
    id: 'treatment-plan',
    label: 'Treatment Plan',
    route: '/treatment-plan'
  },
  {
    group: 'Front Desk',
    id: 'home',
    label: 'Home',
    route: '/home'
  },
  {
    group: 'Front Desk',
    id: 'calendar',
    label: 'Calendar',
    route: '/calendar'
  },
  {
    group: 'Front Desk',
    id: 'patients',
    label: 'Patients',
    route: '/patients'
  },
  {
    group: 'Front Desk',
    id: 'patient-admin',
    label: 'Patient Admin',
    route: '/patient-admin'
  },
  {
    group: 'Operations',
    id: 'patient-communications',
    label: 'Patient Comms',
    route: '/patient-communications'
  },
  {
    group: 'Operations',
    id: 'tasks',
    label: 'Tasks',
    route: '/tasks'
  },
  {
    group: 'Operations',
    id: 'rcm',
    label: 'RCM',
    route: '/rcm'
  },
  {
    group: 'Operations',
    id: 'analytics',
    label: 'Analytics',
    route: '/practice-analytics'
  },
  {
    group: 'System',
    id: 'settings',
    label: 'Settings',
    route: '/settings'
  },
  {
    group: 'System',
    id: 'users',
    label: 'Users',
    route: '/users'
  }
]

export const SMYLR_RETIRED_PRODUCTION_PAGE_IDS = new Set(['dental-imaging'])

export const SMYLR_PRODUCTION_PAGE_GROUPS: SmylrProductionPageGroup[] = [
  'Clinical',
  'Front Desk',
  'Operations',
  'System'
]

export function smylrProductionPageById(id: string | undefined) {
  return SMYLR_PRODUCTION_PAGES.find((page) => page.id === id)
}
