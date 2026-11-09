import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Subtask } from '../../api/types'
import { Button, TextField } from '../../components/forms'
import { Icon } from '../../components/Icon'

const MAX_TITLE = 200

/** "1/3", read out in full by screen readers. Only for a task that has subtasks. */
export function SubtaskProgress({ subtasks }: { subtasks: Subtask[] }) {
  const { t } = useTranslation()
  const done = subtasks.filter((subtask) => subtask.done).length
  const label = t('tasks.subtasksProgress', { done, total: subtasks.length })
  return (
    <span title={label}>
      <span aria-hidden="true">
        {done}/{subtasks.length}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function SubtaskRow({
  item,
  tickable,
  onToggle,
  onRename,
  onRemove,
}: {
  item: Subtask
  tickable: boolean
  /** Settles when saving is over, whether it worked or not. */
  onToggle: () => Promise<unknown>
  onRename: (title: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  // A tick must show in the same moment as the click. Once saving is over, the saved list speaks again,
  // which also takes the tick back if saving failed.
  const [tick, setTick] = useState<boolean | null>(null)
  const done = tick ?? item.done
  const [text, setText] = useState(item.title)
  // A new title from outside (a failed save going back, a change by someone else) replaces what is shown.
  const [seenTitle, setSeenTitle] = useState(item.title)
  if (item.title !== seenTitle) {
    setSeenTitle(item.title)
    setText(item.title)
  }

  function commit() {
    const title = text.trim()
    if (title === '' || title === item.title) setText(item.title)
    else onRename(title)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return
    event.preventDefault() // Enter here saves this line, not the whole form around it
    commit()
  }

  return (
    <li className="flex items-center gap-2 rounded-lg pl-2 hover:bg-primary-bg">
      {tickable ? (
        <input
          type="checkbox"
          checked={done}
          onChange={() => {
            setTick(!done)
            void onToggle().finally(() => setTick(null))
          }}
          aria-label={t('tasks.subtaskDone', { title: item.title })}
          className="h-4 w-4 shrink-0 accent-primary"
        />
      ) : (
        <Icon name="circle" size={10} />
      )}
      <input
        type="text"
        value={text}
        maxLength={MAX_TITLE}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-label={t('tasks.subtaskEdit', { title: item.title })}
        className={`min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 focus:border-primary focus:bg-surface ${
          done ? 'text-muted line-through' : 'text-text'
        }`}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('tasks.subtaskRemove', { title: item.title })}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-text"
      >
        <Icon name="x" size={16} />
      </button>
    </li>
  )
}

/**
 * The smaller things to do inside a task. It only shows the list and reports what the person did: while a
 * task is being created the form keeps the lines itself, and on a saved task each change goes to the server.
 */
export function SubtaskList({
  inputId,
  items,
  tickable,
  hint,
  draft,
  onDraftChange,
  onAdd,
  onToggle,
  onRename,
  onRemove,
  error,
}: {
  /** The box for a new line. A mistake in this section moves the focus there. */
  inputId: string
  items: Subtask[]
  /** Lines can be ticked off (not while the task is still being created). */
  tickable: boolean
  hint?: string | undefined
  draft: string
  onDraftChange: (text: string) => void
  onAdd: () => void
  /** Settles when saving is over, whether it worked or not. */
  onToggle: (item: Subtask) => Promise<unknown>
  onRename: (item: Subtask, title: string) => void
  onRemove: (item: Subtask) => void
  error?: string | undefined
}) {
  const { t } = useTranslation()

  function onDraftKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return
    event.preventDefault() // Enter here adds a line, it does not submit the form around it
    onAdd()
  }

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm font-medium">
        <span>{t('tasks.subtasksLabel')}</span>
        {tickable && items.length > 0 && (
          <span className="font-normal text-muted">
            <SubtaskProgress subtasks={items} />
          </span>
        )}
      </legend>
      {hint && <p className="mb-1 text-sm text-muted">{hint}</p>}
      {items.length > 0 && (
        <ul className="mb-2 space-y-0.5 rounded-xl border border-border bg-surface p-1">
          {items.map((item) => (
            <SubtaskRow
              key={item.id}
              item={item}
              tickable={tickable}
              onToggle={() => onToggle(item)}
              onRename={(title) => onRename(item, title)}
              onRemove={() => {
                onRemove(item)
                // The button that had the focus goes away with its line. Keep the focus inside the dialog.
                document.getElementById(inputId)?.focus()
              }}
            />
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            id={inputId}
            label={t('tasks.subtaskAddLabel')}
            placeholder={t('tasks.subtaskPlaceholder')}
            value={draft}
            maxLength={MAX_TITLE}
            autoComplete="off"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onDraftKeyDown}
            error={error}
          />
        </div>
        {/* mt-6 lines the button up with the box, under the box's label. */}
        <Button
          type="button"
          variant="soft"
          className="mt-6 shrink-0"
          disabled={draft.trim() === ''}
          onClick={onAdd}
        >
          <Icon name="plus" size={16} />
          {t('tasks.subtaskAdd')}
        </Button>
      </div>
    </fieldset>
  )
}
