import { describe, expect, it } from 'vitest'
import {
  loadProjectSort,
  loadProjectsView,
  saveProjectSort,
  saveProjectsView,
} from './projectsView'

describe('projects view', () => {
  it('is cards until the person chooses', () => {
    expect(loadProjectsView()).toBe('cards')
  })

  it('remembers the choice', () => {
    saveProjectsView('list')
    expect(loadProjectsView()).toBe('list')
    saveProjectsView('cards')
    expect(loadProjectsView()).toBe('cards')
  })

  it('ignores anything else found in storage', () => {
    localStorage.setItem('tf-projects-view', 'table')
    expect(loadProjectsView()).toBe('cards')
  })
})

describe('project sort', () => {
  it('is the newest first until the person chooses', () => {
    expect(loadProjectSort()).toBe('newest')
  })

  it('remembers the choice', () => {
    saveProjectSort('progress_low')
    expect(loadProjectSort()).toBe('progress_low')
  })

  it('ignores anything else found in storage', () => {
    localStorage.setItem('tf-projects-sort', 'sideways')
    expect(loadProjectSort()).toBe('newest')
  })
})
