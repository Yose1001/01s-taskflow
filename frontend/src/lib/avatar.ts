// Six pastel pairs. All of them pass the contrast test in src/theme/palette.test.ts.
export const AVATAR_TONES = [
  'bg-primary-bg text-primary-fg',
  'bg-pink-bg text-pink-fg',
  'bg-mint-bg text-mint-fg',
  'bg-sky-bg text-sky-fg',
  'bg-peach-bg text-peach-fg',
  'bg-lemon-bg text-lemon-fg',
] as const

/** The same person always gets the same color, on every page and for everyone looking. */
export function avatarTone(userId: string): (typeof AVATAR_TONES)[number] {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!
}
