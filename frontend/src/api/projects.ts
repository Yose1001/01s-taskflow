import type { RequestFn } from './client'
import type { Member, Page, Project } from './types'

// One function per endpoint in docs/openapi.yaml. IDs go into the path URL-encoded.
const id = encodeURIComponent

export function listProjects(
  request: RequestFn,
  query: { page: number; pageSize: number; trashed: boolean; signal?: AbortSignal | undefined },
): Promise<Page<Project>> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.trashed) params.set('trashed', 'true')
  return request<Page<Project>>(`/projects?${params}`, query.signal ? { signal: query.signal } : {})
}

export function getProject(
  request: RequestFn,
  projectId: string,
  signal?: AbortSignal,
): Promise<Project> {
  return request<Project>(`/projects/${id(projectId)}`, signal ? { signal } : {})
}

export function createProject(
  request: RequestFn,
  input: { name: string; description: string },
): Promise<Project> {
  return request<Project>('/projects', { method: 'POST', body: input })
}

export function updateProject(
  request: RequestFn,
  projectId: string,
  patch: { name?: string; description?: string },
): Promise<Project> {
  return request<Project>(`/projects/${id(projectId)}`, { method: 'PATCH', body: patch })
}

export function deleteProject(request: RequestFn, projectId: string): Promise<void> {
  return request<void>(`/projects/${id(projectId)}`, { method: 'DELETE' })
}

export function restoreProject(request: RequestFn, projectId: string): Promise<Project> {
  return request<Project>(`/projects/${id(projectId)}/restore`, { method: 'POST' })
}

export function listMembers(
  request: RequestFn,
  projectId: string,
  signal?: AbortSignal,
): Promise<Member[]> {
  return request<Member[]>(`/projects/${id(projectId)}/members`, signal ? { signal } : {})
}

export function inviteMember(
  request: RequestFn,
  projectId: string,
  email: string,
): Promise<Member> {
  return request<Member>(`/projects/${id(projectId)}/members`, { method: 'POST', body: { email } })
}

export function removeMember(request: RequestFn, projectId: string, userId: string): Promise<void> {
  return request<void>(`/projects/${id(projectId)}/members/${id(userId)}`, { method: 'DELETE' })
}
