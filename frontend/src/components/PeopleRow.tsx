import { Avatar } from './Avatar'

/**
 * Names, then small pictures of the first three, on one line of a card. `compact` shows only the
 * pictures; the names are still there for screen readers and on hover.
 */
export function PeopleRow({
  people,
  word,
  describe,
  more,
  compact = false,
  className = 'mt-2',
}: {
  people: { id: string; name: string }[]
  /** Said before the names to a screen reader, such as "Members". */
  word: string
  /** The hover text, from the names. */
  describe: (names: string) => string
  /** Added after the names when not everyone is listed, such as "+2 more". */
  more?: string | undefined
  compact?: boolean
  className?: string
}) {
  const names = people.map((p) => p.name).join(', ') + (more ? ` ${more}` : '')
  return (
    <span
      title={compact ? describe(names) : undefined}
      className={`flex min-h-[22px] items-center gap-2 text-sm text-muted ${compact ? '' : 'justify-between'} ${className}`}
    >
      <span
        className={compact ? 'sr-only' : 'min-w-0 truncate'}
        title={compact ? undefined : describe(names)}
      >
        <span className="sr-only">{word} </span>
        {names}
      </span>
      <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
        {people.slice(0, 3).map((p) => (
          <span key={p.id} className="rounded-full ring-2 ring-surface">
            <Avatar id={p.id} name={p.name} size={22} />
          </span>
        ))}
      </span>
    </span>
  )
}
