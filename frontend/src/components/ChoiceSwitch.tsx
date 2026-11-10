import { Icon, type IconName } from './Icon'

/** Ways to show the same thing, side by side. On phones the buttons show only their icons. */
export function ChoiceSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string
  value: T
  options: { value: T; icon: IconName; label: string }[]
  onChange: (value: T) => void
  className?: string | undefined
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex h-10 items-center gap-0.5 rounded-xl border border-border bg-surface p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium ${
            value === option.value ? 'bg-primary-bg text-primary-fg' : 'text-muted hover:text-text'
          }`}
        >
          <Icon name={option.icon} />
          <span className="max-sm:sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
