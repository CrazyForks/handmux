// The window to swap with when nudging window `id` one slot in `dir` ('left' | 'right'), or null at
// the edge (no neighbour) or when the id is no longer in the list. Order mirrors list-windows (tmux
// window index), so the neighbour is just the adjacent array element.
export function moveTarget(windows, id, dir) {
  const i = windows.findIndex((w) => w.id === id);
  if (i < 0) return null;
  return windows[dir === 'left' ? i - 1 : i + 1] ?? null;
}
