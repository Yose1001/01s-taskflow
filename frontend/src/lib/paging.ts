/** Reads ?page=N from the address. Anything that is not a whole number >= 1 means page 1 (never trust the URL). */
export function parsePage(value: string | null): number {
  if (value === null || !/^\d{1,6}$/.test(value)) return 1
  const page = Number(value)
  return page >= 1 ? page : 1
}

export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
