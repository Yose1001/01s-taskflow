import { useTranslation } from 'react-i18next'
import type { Member } from '../../api/types'
import { Avatar } from '../../components/Avatar'

/**
 * Who works on a task: a list of checkboxes, because a task can have any number of people. Plain
 * checkboxes also work with the keyboard and screen readers without any extra code.
 */
export function AssigneePicker({
  id,
  members,
  selected,
  onChange,
  error,
}: {
  /** Given to the first checkbox, so that a mistake here can move the focus to the list. */
  id: string
  members: Member[]
  selected: string[]
  onChange: (next: string[]) => void
  error?: string | undefined
}) {
  const { t } = useTranslation()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  return (
    // min-w-0: by default a fieldset grows to fit its content, and a long email would push the dialog wider.
    <fieldset className="min-w-0" aria-describedby={error ? `${hintId} ${errorId}` : hintId}>
      <legend className="mb-1 block text-sm font-medium">{t('tasks.assigneeLabel')}</legend>
      <p id={hintId} className="mb-1 text-sm text-muted">
        {t('tasks.assigneeHint')}
      </p>
      <ul className="max-h-48 space-y-0.5 overflow-auto rounded-xl border border-border bg-surface p-1">
        {members.map((member, index) => {
          const checked = selected.includes(member.userId)
          return (
            <li key={member.userId}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 ${
                  checked ? 'bg-primary-bg' : 'hover:bg-primary-bg'
                }`}
              >
                <input
                  id={index === 0 ? id : undefined}
                  type="checkbox"
                  checked={checked}
                  aria-invalid={error ? true : undefined}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((userId) => userId !== member.userId)
                        : [...selected, member.userId],
                    )
                  }
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <Avatar id={member.userId} name={member.email} size={24} />
                <span className="min-w-0 break-words">{member.email}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {error && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger-fg">
          {error}
        </p>
      )}
    </fieldset>
  )
}
