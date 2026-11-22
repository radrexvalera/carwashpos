// PostgREST caps every response at max_rows (1000) without erroring, and a long `in.(...)` list
// overflows the request URL (~400+ uuids gets HTTP 400). Reports over a week or more hit both.

type PagedQuery<T> = {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

const PAGE_SIZE = 1000
const ID_CHUNK_SIZE = 150

// `build` must apply a stable .order() so pages don't overlap or skip rows.
export async function fetchAllRows<T>(build: () => PagedQuery<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

export async function fetchRowsIn<T>(ids: string[], build: (chunk: string[]) => PagedQuery<T>): Promise<T[]> {
  const unique = [...new Set(ids)]
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += ID_CHUNK_SIZE) chunks.push(unique.slice(i, i + ID_CHUNK_SIZE))
  const results = await Promise.all(chunks.map((chunk) => fetchAllRows(() => build(chunk))))
  return results.flat()
}
