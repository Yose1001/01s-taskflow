import type { TFunction } from 'i18next'
import { ApiError } from '../api/client'

// Error codes the API can return that have their own message. Anything else gets the generic message.
// The test in errors.test.ts checks this list against docs/openapi.yaml, so a new backend code cannot be forgotten.
export const KNOWN_ERROR_CODES = [
  'unauthorized',
  'invalid_credentials',
  'forbidden',
  'not_found',
  'email_taken',
  'already_member',
  'validation_failed',
  'bad_request',
  'rate_limited',
  'network',
] as const

export const KNOWN_FIELD_CODES = [
  'required',
  'invalid_email',
  'password_too_short',
  'password_too_long',
  'invalid_display_name',
  'email_taken',
  'invalid_name',
  'description_too_long',
  'nothing_to_update',
  'cannot_remove_owner',
  'invalid_title',
  'task_description_too_long', // our own code: the API's description_too_long means 2000 for projects, 5000 for tasks
  'invalid_status',
  'invalid_priority',
  'invalid_assignee',
  'not_a_member',
  'invalid_date',
] as const

const known = new Set<string>(KNOWN_ERROR_CODES)
const knownFields = new Set<string>(KNOWN_FIELD_CODES)

/** A sentence for the person using the app. Never shows raw server text. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    const key = known.has(error.code) ? error.code : 'generic'
    return t(`errors.${key}`, { seconds: error.retryAfter ?? 60 })
  }
  return t('errors.generic')
}

/** The message for one form field's error code (from the server or from our own checks). */
export function fieldErrorMessage(t: TFunction, code: string): string {
  return t(`fieldErrors.${knownFields.has(code) ? code : 'invalid'}`)
}
