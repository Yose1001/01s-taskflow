import { avatarTone } from '../lib/avatar'
import { initials } from '../lib/format'

function textSize(size: number): string {
  if (size < 26) return 'text-[10px]'
  return size < 40 ? 'text-xs' : 'text-sm'
}

/** A person's initials in a circle. Decorative: the person's name must also be available as text. */
export function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-full font-semibold leading-none ${textSize(size)} ${avatarTone(id)}`}
    >
      {initials(name)}
    </span>
  )
}

/** The empty circle shown when nobody is assigned. */
export function EmptyAvatar({ label, size = 36 }: { label: string; size?: number }) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full border border-dashed border-muted"
    />
  )
}
