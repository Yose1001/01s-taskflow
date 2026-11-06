import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createTask,
  deleteTask,
  listAllTasks,
  moveTask,
  restoreTask,
  updateTask,
  type TaskInput,
  type TaskPatch,
} from '../../api/tasks'
import type { Task } from '../../api/types'
import { useAuth } from '../../auth/context'
import { applyMove, type Move } from './boardLogic'

// Cache keys. Everything about one project's tasks starts with ['tasks', projectId].
export const taskKeys = {
  all: (projectId: string) => ['tasks', projectId] as const,
  board: (projectId: string) => ['tasks', projectId, 'board'] as const,
  trash: (projectId: string) => ['tasks', projectId, 'trash'] as const,
}

/** All active tasks of a project. The board filters and groups them itself, so there is one request, not one per filter. */
export function useTasks(projectId: string) {
  const { request } = useAuth()
  return useQuery({
    queryKey: taskKeys.board(projectId),
    queryFn: ({ signal }) => listAllTasks(request, projectId, { trashed: false, signal }),
  })
}

export function useTrashedTasks(projectId: string) {
  const { request } = useAuth()
  return useQuery({
    queryKey: taskKeys.trash(projectId),
    queryFn: ({ signal }) => listAllTasks(request, projectId, { trashed: true, signal }),
  })
}

export function useCreateTask(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TaskInput) => createTask(request, projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all(projectId) }),
  })
}

/** Saves the edited fields, then (if the column changed) moves the task to the end of the new column. */
export function useUpdateTask(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { task: Task; patch: TaskPatch; status?: Move['status'] }) => {
      let saved = vars.task
      if (Object.keys(vars.patch).length > 0)
        saved = await updateTask(request, vars.task.id, vars.patch)
      if (vars.status && vars.status !== saved.status)
        saved = await moveTask(request, vars.task.id, vars.status, null)
      return saved
    },
    // Also refresh when it fails half-way (the first step may have been saved).
    onSettled: () => qc.invalidateQueries({ queryKey: taskKeys.all(projectId) }),
  })
}

export function useDeleteTask(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => deleteTask(request, taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all(projectId) }),
  })
}

export function useRestoreTask(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => restoreTask(request, taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all(projectId) }),
  })
}

/**
 * Drag and drop. The board changes at once (so it feels instant) and goes back if the server says no.
 * Afterwards it reloads, so the screen always ends up showing what the server has.
 */
export function useMoveTask(projectId: string) {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (move: Move) => moveTask(request, move.taskId, move.status, move.beforeTaskId),
    onMutate: async (move) => {
      await qc.cancelQueries({ queryKey: taskKeys.board(projectId) })
      const previous = qc.getQueryData<Task[]>(taskKeys.board(projectId))
      if (previous) qc.setQueryData(taskKeys.board(projectId), applyMove(previous, move))
      return { previous }
    },
    onError: (_error, _move, context) => {
      if (context?.previous) qc.setQueryData(taskKeys.board(projectId), context.previous)
    },
    // Not returned on purpose: the mutation would wait for the reload before reporting its result,
    // and on a slow connection the person would not hear about a failed move until then.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.all(projectId) })
    },
  })
}
