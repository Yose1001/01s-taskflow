import type { RequestFn } from './client'
import type { Page, Subtask, Task, TaskPriority, TaskStatus } from './types'

// One function per task endpoint in docs/openapi.yaml.
const id = encodeURIComponent

/** The API's largest page. */
export const TASK_PAGE_SIZE = 100
/** Safety stop so a huge project cannot make the board fetch forever (20 x 100 = 2000 tasks). */
const MAX_PAGES = 20

export interface TaskInput {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  /** Needed when the task is on hold. */
  holdReason?: string
  assigneeIds?: string[]
  /** Titles, in order. Only when creating: afterwards each subtask changes on its own. */
  subtasks?: string[]
  startDate?: string | null
  dueDate?: string | null
}

/** status cannot be changed here; use moveTask. */
export type TaskPatch = Partial<Omit<TaskInput, 'status' | 'subtasks'>>

function listTasks(
  request: RequestFn,
  projectId: string,
  query: { page: number; trashed: boolean; signal?: AbortSignal | undefined },
): Promise<Page<Task>> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(TASK_PAGE_SIZE) })
  if (query.trashed) params.set('trashed', 'true')
  return request<Page<Task>>(
    `/projects/${id(projectId)}/tasks?${params}`,
    query.signal ? { signal: query.signal } : {},
  )
}

/** Every task of a project (active, or the trash), reading page after page. */
export async function listAllTasks(
  request: RequestFn,
  projectId: string,
  options: { trashed: boolean; signal?: AbortSignal | undefined },
): Promise<Task[]> {
  const all: Task[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await listTasks(request, projectId, { page, ...options })
    all.push(...result.items)
    if (result.items.length === 0 || all.length >= result.total) break
  }
  return all
}

export function createTask(request: RequestFn, projectId: string, input: TaskInput): Promise<Task> {
  return request<Task>(`/projects/${id(projectId)}/tasks`, { method: 'POST', body: input })
}

export function updateTask(request: RequestFn, taskId: string, patch: TaskPatch): Promise<Task> {
  return request<Task>(`/tasks/${id(taskId)}`, { method: 'PATCH', body: patch })
}

export function deleteTask(request: RequestFn, taskId: string): Promise<void> {
  return request<void>(`/tasks/${id(taskId)}`, { method: 'DELETE' })
}

export function restoreTask(request: RequestFn, taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${id(taskId)}/restore`, { method: 'POST' })
}

export function addSubtask(request: RequestFn, taskId: string, title: string): Promise<Subtask> {
  return request<Subtask>(`/tasks/${id(taskId)}/subtasks`, { method: 'POST', body: { title } })
}

export function updateSubtask(
  request: RequestFn,
  taskId: string,
  subtaskId: string,
  patch: Partial<Pick<Subtask, 'title' | 'done'>>,
): Promise<Subtask> {
  return request<Subtask>(`/tasks/${id(taskId)}/subtasks/${id(subtaskId)}`, {
    method: 'PATCH',
    body: patch,
  })
}

export function deleteSubtask(
  request: RequestFn,
  taskId: string,
  subtaskId: string,
): Promise<void> {
  return request<void>(`/tasks/${id(taskId)}/subtasks/${id(subtaskId)}`, { method: 'DELETE' })
}

/**
 * Put a task in a column, before another task (null = at the end of the column). Going on hold needs a reason;
 * a task that is already on hold keeps its own, and any other column clears it.
 */
export function moveTask(
  request: RequestFn,
  taskId: string,
  status: TaskStatus,
  beforeTaskId: string | null,
  holdReason?: string,
): Promise<Task> {
  return request<Task>(`/tasks/${id(taskId)}/move`, {
    method: 'POST',
    body: { status, beforeTaskId, ...(holdReason !== undefined && { holdReason }) },
  })
}
