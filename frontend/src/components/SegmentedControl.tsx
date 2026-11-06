interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
}

/** A small row of mutually exclusive buttons (used for theme and language). Keyboard and screen-reader friendly. */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-full border border-border bg-surface-2 p-1"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={
              'rounded-full px-3 py-1 text-sm font-medium transition-colors ' +
              (selected ? 'bg-primary text-on-primary' : 'text-muted hover:text-text')
            }
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
