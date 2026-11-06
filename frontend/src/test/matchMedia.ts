// jsdom has no matchMedia. This fake lets tests choose whether the "operating system" prefers dark.

type Listener = (event: MediaQueryListEvent) => void

let systemDark = false
const listeners = new Set<Listener>()

function fakeMatchMedia(query: string): MediaQueryList {
  return {
    get matches() {
      return query.includes('prefers-color-scheme: dark') ? systemDark : false
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.delete(listener)
    },
    addListener: (listener: Listener) => {
      listeners.add(listener)
    },
    removeListener: (listener: Listener) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => false,
  } as unknown as MediaQueryList
}

export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: fakeMatchMedia,
  })
}

/** Simulates the user switching the operating system between light and dark. */
export function setSystemDark(value: boolean): void {
  systemDark = value
  for (const listener of [...listeners]) listener({ matches: value } as MediaQueryListEvent)
}

export function resetMatchMedia(): void {
  systemDark = false
  listeners.clear()
  installMatchMedia()
}
