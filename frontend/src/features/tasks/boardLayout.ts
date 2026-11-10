/** How the columns sit on a wide screen: all in one row, or two per row. Smaller screens have their own. */
export type BoardLayout = 'row' | 'two'

const STORAGE_KEY = 'tf-board-layout'

/** How this device shows the board. One row unless the person chose two per row. */
export function loadBoardLayout(): BoardLayout {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'two' ? 'two' : 'row'
  } catch {
    return 'row'
  }
}

export function saveBoardLayout(layout: BoardLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, layout)
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
}
