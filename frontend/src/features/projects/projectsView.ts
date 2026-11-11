export type ProjectsView = 'cards' | 'list'

const STORAGE_KEY = 'tf-projects-view'

/** How this device shows the project list. Cards unless the person chose the list. */
export function loadProjectsView(): ProjectsView {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

export function saveProjectsView(view: ProjectsView) {
  try {
    localStorage.setItem(STORAGE_KEY, view)
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
}

export const PROJECT_SORTS = [
  'newest',
  'oldest',
  'updated',
  'name',
  'progress_high',
  'progress_low',
] as const
export type ProjectSort = (typeof PROJECT_SORTS)[number]

const SORT_KEY = 'tf-projects-sort'

/** How this device sorts the project list. The newest first unless the person chose something else. */
export function loadProjectSort(): ProjectSort {
  try {
    const saved = localStorage.getItem(SORT_KEY)
    return PROJECT_SORTS.find((sort) => sort === saved) ?? 'newest'
  } catch {
    return 'newest'
  }
}

export function saveProjectSort(sort: ProjectSort) {
  try {
    localStorage.setItem(SORT_KEY, sort)
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
}
