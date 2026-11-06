import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createProject,
  deleteProject,
  getProject,
  inviteMember,
  listMembers,
  listProjects,
  removeMember,
  restoreProject,
  updateProject,
} from '../../api/projects'
import { useAuth } from '../../auth/context'
import { taskKeys } from '../tasks/hooks'

export const PAGE_SIZE = 12

// Cache keys. Everything about projects starts with 'projects' or 'project', so one call can refresh a whole family.
export const keys = {
  lists: ['projects'] as const,
  list: (page: number, trashed: boolean) => ['projects', { page, trashed }] as const,
  detail: (projectId: string) => ['project', projectId] as const,
  members: (projectId: string) => ['members', projectId] as const,
}

export function useProjects(page: number, trashed = false) {
  const { request } = useAuth()
  return useQuery({
    queryKey: keys.list(page, trashed),
    queryFn: ({ signal }) => listProjects(request, { page, pageSize: PAGE_SIZE, trashed, signal }),
    placeholderData: keepPreviousData, // keep showing the old page while the next one loads
  })
}

export function useProject(projectId: string) {
  const { request } = useAuth()
  return useQuery({
    queryKey: keys.detail(projectId),
    queryFn: ({ signal }) => getProject(request, projectId, signal),
  })
}

/** enabled=false waits (for example until the project itself has loaded). */
export function useMembers(projectId: string, enabled = true) {
  const { request } = useAuth()
  return useQuery({
    queryKey: keys.members(projectId),
    queryFn: ({ signal }) => listMembers(request, projectId, signal),
    enabled,
  })
}

export function useCreateProject() {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; description: string }) => createProject(request, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.lists }),
  })
}

export function useUpdateProject(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { name?: string; description?: string }) =>
      updateProject(request, projectId, patch),
    onSuccess: (project) => {
      qc.setQueryData(keys.detail(projectId), project)
      return qc.invalidateQueries({ queryKey: keys.lists })
    },
  })
}

export function useDeleteProject() {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => deleteProject(request, projectId),
    onSuccess: (_data, projectId) => {
      qc.removeQueries({ queryKey: keys.detail(projectId) })
      qc.removeQueries({ queryKey: keys.members(projectId) })
      qc.removeQueries({ queryKey: taskKeys.all(projectId) })
      return qc.invalidateQueries({ queryKey: keys.lists }) // active list and trash both change
    },
  })
}

export function useRestoreProject() {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => restoreProject(request, projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.lists }),
  })
}

export function useInviteMember(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => inviteMember(request, projectId, email),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(projectId) }),
  })
}

export function useRemoveMember(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => removeMember(request, projectId, userId),
    // Tasks assigned to the removed person become unassigned, so the board must reload too.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(projectId) }),
        qc.invalidateQueries({ queryKey: taskKeys.all(projectId) }),
      ]),
  })
}
