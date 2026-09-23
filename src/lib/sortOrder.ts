// Re-numbers the whole list to clean sequential 0..n-1 values on every move (rather than swapping
// the two rows' raw sort_order values) so this works correctly even when existing rows share the
// same value -- e.g. everything still sitting at the '0' the add-form defaults to -- which a
// simple two-row swap would silently no-op on. Only rows whose value actually changes get persisted.
export async function moveInSortOrder<T extends { id: string; sort_order: number }>(
  rows: T[],
  index: number,
  direction: -1 | 1,
  updateSortOrder: (id: string, sortOrder: number) => Promise<void>,
) {
  const target = index + direction
  if (target < 0 || target >= rows.length) return

  const reordered = [...rows]
  const [moved] = reordered.splice(index, 1)
  reordered.splice(target, 0, moved)

  const changes = reordered
    .map((row, i) => ({ id: row.id, oldOrder: row.sort_order, newOrder: i }))
    .filter((c) => c.oldOrder !== c.newOrder)

  await Promise.all(changes.map((c) => updateSortOrder(c.id, c.newOrder)))
}
