import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import type { Project } from '../../api/types'
import { errorMessage, fieldErrorMessage } from '../../auth/errors'
import { Alert, Button, TextAreaField, TextField } from '../../components/forms'
import { Modal } from '../../components/Modal'
import { useCreateProject, useUpdateProject } from './hooks'

const MAX_NAME = 120
const MAX_DESCRIPTION = 2000

type Errors = Partial<Record<'name' | 'description', string>>

interface Props {
  /** Present when editing; absent when creating. */
  project?: Project
  onClose: () => void
  onSaved: (project: Project) => void
}

/** The create / edit form, in a dialog. Checks input first, then maps server field errors onto the fields. */
export function ProjectFormDialog({ project, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const editing = project !== undefined
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [errors, setErrors] = useState<Errors>({})

  const create = useCreateProject()
  const update = useUpdateProject(project?.id ?? '')
  const mutation = editing ? update : create

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    const next: Errors = {}
    const length = Array.from(trimmed).length
    if (length < 1) next.name = 'required'
    else if (length > MAX_NAME) next.name = 'invalid_name'
    if (Array.from(description).length > MAX_DESCRIPTION) next.description = 'description_too_long'
    setErrors(next)
    if (next.name || next.description) {
      document.getElementById(next.name ? 'project-name' : 'project-description')?.focus()
      return
    }

    const input = { name: trimmed, description }
    const handlers = {
      onSuccess: (saved: Project) => onSaved(saved),
      onError: (error: unknown) => {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          setErrors({
            ...(error.fields.name && { name: error.fields.name }),
            ...(error.fields.description && { description: error.fields.description }),
          })
        }
      },
    }
    if (editing) update.mutate(input, handlers)
    else create.mutate(input, handlers)
  }

  const serverError = mutation.error
  const showBanner =
    serverError && !(serverError instanceof ApiError && serverError.code === 'validation_failed')
  const pending = mutation.isPending

  return (
    <Modal
      title={editing ? t('projects.editTitle') : t('projects.createTitle')}
      onClose={pending ? () => {} : onClose}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {showBanner && <Alert>{errorMessage(t, serverError)}</Alert>}
        <TextField
          id="project-name"
          label={t('projects.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name ? fieldErrorMessage(t, errors.name) : undefined}
          autoComplete="off"
        />
        <TextAreaField
          id="project-description"
          label={t('projects.description')}
          hint={t('projects.descriptionHint')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description ? fieldErrorMessage(t, errors.description) : undefined}
        />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button type="button" variant="soft" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending
              ? editing
                ? t('projects.saving')
                : t('projects.creating')
              : editing
                ? t('projects.save')
                : t('projects.create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
