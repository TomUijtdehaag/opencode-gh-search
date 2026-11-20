import type { createSignal as CreateSignal, onCleanup as OnCleanup } from "solid-js"
import { GhSearch, type Cursor, type Item, type Kind, type Page, type Resolved, type Viewer } from "./rpc.js"

const DEBOUNCE_MS = 150
const INDEX_POLL_MS = 1500

type Client = { rpc: (contract: typeof GhSearch) => any }

/**
 * The search dialog's state, shared by the Desktop and terminal UIs: resolves `@repo`, loads batches,
 * pages on demand and re-reads results while a repo's index is still syncing. Call inside a Solid component.
 *
 * Takes Solid's primitives from the caller: a TUI plugin must use the host's Solid instance, and a plain `.ts`
 * import of `solid-js` here can resolve to a different copy whose signals the host never sees.
 */
export function createSearch(options: {
  solid: { createSignal: typeof CreateSignal; onCleanup: typeof OnCleanup }
  client: Client
  kind: Kind
  directory: string
  initial: string
  batch: number
  /** Called after a new query's first batch has replaced the rows. */
  onReset?: () => void
  /** Called after more rows were appended. */
  onMore?: () => void
}) {
  const { createSignal, onCleanup } = options.solid
  const gh = options.client.rpc(GhSearch)
  const [text, setText] = createSignal(options.initial)
  const [rows, setRows] = createSignal<Item[]>([])
  const [repos, setRepos] = createSignal<string[]>([])
  const [selected, setSelected] = createSignal(0)
  const [searching, setSearching] = createSignal(false)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [indexing, setIndexing] = createSignal(false)
  const [error, setError] = createSignal("")
  const [viewer, setViewer] = createSignal<Viewer>({ login: "", teams: [] })
  let target: { dirs: string[]; query: string } | undefined
  let next: Cursor | undefined
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    clearTimeout(timer)
    clearTimeout(poll)
  })

  const fetch = (size: number, cursor?: Cursor) =>
    gh.search({ kind: options.kind, ...target!, size, ...(cursor ? { cursor } : {}) }) as Promise<Page>

  async function run(value: string) {
    const id = ++seq
    setSearching(true)
    setLoadingMore(false)
    setError("")
    try {
      const resolved = (await gh.resolve({ directory: options.directory, input: value })) as Resolved
      if (id !== seq) return
      next = undefined
      target = { dirs: resolved.repos.map((repo) => repo.dir), query: resolved.query }
      if (resolved.repos.length === 0) {
        setRepos([])
        setRows([])
        setIndexing(false)
        setError(`No repository matches ${value.trim().split(/\s+/)[0]}`)
        return
      }
      const page = await fetch(options.batch)
      if (id !== seq) return
      next = page.next
      setRepos(page.repos)
      setRows(page.items)
      setIndexing(page.indexing)
      setViewer(page.viewer)
      setError(page.error ?? "")
      setSelected(0)
      watchIndex(id)
      options.onReset?.()
    } catch (e) {
      if (id !== seq) return
      setRows([])
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === seq) setSearching(false)
    }
  }

  async function more() {
    if (!target || !next || loadingMore()) return
    const id = seq
    setLoadingMore(true)
    try {
      const page = await fetch(options.batch, next)
      if (id !== seq) return
      next = page.next
      setRows((list) => [...list, ...page.items])
      setIndexing(page.indexing)
      setError(page.error ?? "")
    } catch (e) {
      if (id === seq) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === seq) setLoadingMore(false)
    }
    if (id === seq) options.onMore?.()
  }

  // While a repo's index is still syncing, re-read the rows already shown so newly indexed items appear.
  function watchIndex(id: number) {
    clearTimeout(poll)
    if (!indexing()) return
    poll = setTimeout(async () => {
      if (id !== seq || !target) return
      try {
        const page = await fetch(Math.max(rows().length, options.batch))
        if (id !== seq) return
        next = page.next
        setRows(page.items)
        setIndexing(page.indexing)
        setError(page.error ?? "")
        setSelected((i) => Math.min(i, Math.max(page.items.length - 1, 0)))
      } catch {}
      watchIndex(id)
    }, INDEX_POLL_MS)
  }

  function input(value: string) {
    setText(value)
    clearTimeout(timer)
    timer = setTimeout(() => void run(value), DEBOUNCE_MS)
  }

  /** Moves the selection by `delta` rows, loading more when it nears the end. */
  function move(delta: number, lookahead: number) {
    const count = rows().length
    if (!count) return
    const index = Math.max(0, Math.min(selected() + delta, count - 1))
    setSelected(index)
    if (index >= count - lookahead) void more()
  }

  void run(options.initial)

  return {
    text,
    input,
    rows,
    repos,
    selected,
    setSelected,
    move,
    more,
    searching,
    loadingMore,
    indexing,
    error,
    viewer,
    hasMore: () => !!next,
    many: () => repos().length > 1,
    current: () => rows()[selected()] as Item | undefined,
  }
}
