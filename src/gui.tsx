import { createSignal, For, onCleanup, Show } from "solid-js"
import { Command, LinkHandler, Plugin, Style, type DialogHandle } from "@opencode/plugin/gui"
import { GhPr, type Cursor, type Pull, type Pulls, type Resolved } from "./rpc"

const ROW_HEIGHT = 48

const STACK_ICON = "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-stack\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M7.122.392a1.75 1.75 0 0 1 1.756 0l5.003 2.902c.83.481.83 1.68 0 2.162L8.878 8.358a1.75 1.75 0 0 1-1.756 0L2.119 5.456a1.251 1.251 0 0 1 0-2.162ZM8.125 1.69a.248.248 0 0 0-.25 0l-4.63 2.685 4.63 2.685a.248.248 0 0 0 .25 0l4.63-2.685ZM1.601 7.789a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0L1.874 8.814A.75.75 0 0 1 1.6 7.789Zm0 3.5a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0l-5.248-3.044a.75.75 0 0 1-.273-1.025Z\"></path></svg>"

// GitHub octicons (MIT), inlined so the bundle stays small.
const states: Record<string, { label: string; icon: string }> = {
  open: { label: "Open", icon: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-pull-request\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z\"></path></svg>" },
  draft: { label: "Draft", icon: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-pull-request-draft\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z\"></path></svg>" },
  merged: { label: "Merged", icon: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-merge\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z\"></path></svg>" },
  closed: { label: "Closed", icon: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-pull-request-closed\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z\"></path></svg>" },
}
const BATCH = 20

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

/** "yesterday", "5 days ago", like GitHub. */
function ago(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return "just now"
}

/** GitHub's wording: what last happened to the PR, and when. */
function when(pull: Pull): string {
  if (pull.mergedAt) return `merged ${ago(pull.mergedAt)}`
  if (pull.closedAt) return `closed ${ago(pull.closedAt)}`
  return pull.createdAt ? `opened ${ago(pull.createdAt)}` : ""
}
const DEBOUNCE_MS = 150
const INDEX_POLL_MS = 1500

// The app's list markup (`data-component=list`) gives rows, search field and selection the host's styling.
// Only the state badge and pager are ours; GitHub's state colors are the one deliberate non-theme color.
const css = `
[data-gh-pr] [data-slot=list-search-input] {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 0;
  color: var(--text-strong); font-family: var(--font-family-sans); font-size: var(--font-size-base, 14px);
  line-height: 20px;
}
[data-gh-pr] [data-slot=list-search-input]::placeholder { color: var(--text-weak); }
[data-gh-pr] [data-slot=list-item] { display: flex; gap: 8px; cursor: default; position: relative; }
[data-gh-pr] .gh-pr-title,
[data-gh-pr] .gh-pr-weak { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-gh-pr] .gh-pr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
[data-gh-pr] .gh-pr-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
[data-gh-pr] .gh-pr-title { flex: 1; }
[data-gh-pr] .gh-pr-meta {
  color: var(--text-weak); font-size: var(--font-size-small, 12px); font-weight: var(--font-weight-regular);
  line-height: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-gh-pr] .gh-pr-weak { color: var(--text-weak); font-weight: var(--font-weight-regular); flex-shrink: 0; }
/* GitHub's Primer "State" label, small variant, with its octicon. */
[data-gh-pr] .gh-pr-state-cell { flex-shrink: 0; width: 76px; display: flex; }
[data-gh-pr] .gh-pr-stack { width: 44px; display: inline-flex; align-items: center; gap: 3px; }
[data-gh-pr] .gh-pr-stack svg { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }
[data-gh-pr] .gh-pr-state {
  display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; box-sizing: border-box;
  border-radius: 2em; color: #fff; font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap;
}
[data-gh-pr] .gh-pr-state svg { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }
[data-gh-pr] .gh-pr-state[data-state=open] { background: #1f883d; }
[data-gh-pr] .gh-pr-state[data-state=draft] { background: #59636e; }
[data-gh-pr] .gh-pr-state[data-state=merged] { background: #8250df; }
[data-gh-pr] .gh-pr-state[data-state=closed] { background: #cf222e; }
/* Pinned to the dialog body (position: relative) so only the results scroll and the search stays on top. */
[data-gh-pr][data-component=list] {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px; overflow: hidden;
  padding: 4px 16px 12px; box-sizing: border-box;
}
[data-gh-pr] [data-slot=list-search-wrapper] { flex-shrink: 0; }
[data-gh-pr] [data-slot=list-scroll] { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
[data-gh-pr] [data-slot=list-item] { height: ${ROW_HEIGHT}px; box-sizing: border-box; }
[data-gh-pr] .gh-pr-more {
  display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 1px; padding: 4px 0 12px;
  color: var(--text-weak); font-size: var(--font-size-small, 12px);
}
`


export default Plugin.define({
  setup(ctx) {
    const ui = ctx.ui
    ctx.add(Style, css)

    ctx.add(LinkHandler, {
      match: (link) => link.origin === ctx.id,
      open: (link) => ctx.system.openExternal(link.href),
    })

    function attach(pull: Pull) {
      const repo = pull.repo
      const composer = ctx.screen.current()?.composer
      if (!composer) return
      composer.attach({
        type: "note",
        origin: ctx.id,
        commentID: crypto.randomUUID(),
        label: `${repo.split("/").pop()}#${pull.number}`,
        subtitle: pull.title,
        icon: "github",
        subject: [
          `GitHub pull request ${repo}#${pull.number}: "${pull.title}"`,
          `(${pull.state}, branch ${pull.branch}, by ${pull.author}, ${pull.url}).`,
          `Read it with \`gh pr view ${pull.number} -R ${repo}\` if you need its details.`,
        ].join(" "),
        comment: "",
        href: pull.url,
      })
      composer.focus()
    }

    function Search(props: { directory: string; initial: string; dialog: DialogHandle }) {
      const gh = ctx.client.rpc(GhPr)
      const [text, setText] = createSignal(props.initial)
      const [rows, setRows] = createSignal<Pull[]>([])
      const [repos, setRepos] = createSignal<string[]>([])
      const [selected, setSelected] = createSignal(0)
      const [searching, setSearching] = createSignal(false)
      const [loadingMore, setLoadingMore] = createSignal(false)
      const [error, setError] = createSignal("")
      const [indexing, setIndexing] = createSignal(false)
      let poll: ReturnType<typeof setTimeout> | undefined
      let target: { dirs: string[]; query: string } | undefined
      let next: Cursor | undefined
      let seq = 0
      let timer: ReturnType<typeof setTimeout> | undefined
      let scroll: HTMLDivElement | undefined
      let sentinel: HTMLDivElement | undefined
      let observer: IntersectionObserver | undefined
      onCleanup(() => {
        clearTimeout(timer)
        clearTimeout(poll)
        observer?.disconnect()
      })

      async function more() {
        if (!target || !next || loadingMore()) return
        const id = seq
        setLoadingMore(true)
        try {
          const result = (await gh.pulls({ ...target, size: BATCH, cursor: next })) as Pulls
          if (id !== seq) return
          next = result.next
          setRows((list) => [...list, ...result.pulls])
          setIndexing(result.indexing)
        } catch (e) {
          if (id === seq) setError(e instanceof Error ? e.message : String(e))
        } finally {
          if (id === seq) setLoadingMore(false)
        }
        // A short first batch may not fill the list yet; keep going while the end is still visible.
        if (id === seq) queueMicrotask(checkEnd)
      }

      function checkEnd() {
        if (!scroll || !sentinel) return
        if (sentinel.getBoundingClientRect().top <= scroll.getBoundingClientRect().bottom + ROW_HEIGHT * 4) void more()
      }

      async function search(value: string) {
        const id = ++seq
        setSearching(true)
        setLoadingMore(false)
        setError("")
        try {
          const resolved = (await gh.resolve({ directory: props.directory, input: value })) as Resolved
          if (id !== seq) return
          next = undefined
          target = { dirs: resolved.repos.map((repo) => repo.dir), query: resolved.query }
          const result = (await gh.pulls({ ...target, size: BATCH })) as Pulls
          if (id !== seq) return
          next = result.next
          setRepos(result.repos)
          setRows(result.pulls)
          setIndexing(result.indexing)
          setSelected(0)
          scroll?.scrollTo({ top: 0 })
          watchIndex(id)
          queueMicrotask(checkEnd)
        } catch (e) {
          if (id === seq) {
            setRows([])
            setError(e instanceof Error ? e.message : String(e))
          }
        } finally {
          if (id === seq) setSearching(false)
        }
      }

      // While a repo's index is still syncing, re-read the rows already shown so newly indexed PRs appear.
      function watchIndex(id: number) {
        clearTimeout(poll)
        if (!indexing()) return
        poll = setTimeout(async () => {
          if (id !== seq || !target) return
          try {
            const size = Math.max(rows().length, BATCH)
            const result = (await gh.pulls({ ...target, size })) as Pulls
            if (id !== seq) return
            next = result.next
            setRows(result.pulls)
            setIndexing(result.indexing)
            setSelected((i) => Math.min(i, Math.max(result.pulls.length - 1, 0)))
          } catch {}
          watchIndex(id)
        }, INDEX_POLL_MS)
      }

      function onInput(value: string) {
        setText(value)
        clearTimeout(timer)
        timer = setTimeout(() => void search(value), DEBOUNCE_MS)
      }

      function pick(pull: Pull | undefined) {
        if (!pull) return
        props.dialog.close()
        attach(pull)
      }

      const many = () => repos().length > 1
      // Same title and always a description, so the header keeps its height while the repo scope changes.
      const scope = () =>
        repos().length === 1 ? repos()[0] : repos().length > 1 ? `${repos().length} repositories` : "Searching…"

      function select(index: number) {
        setSelected(index)
        scroll?.querySelectorAll("[data-slot=list-item]")[index]?.scrollIntoView({ block: "nearest" })
      }

      function onKeyDown(event: KeyboardEvent) {
        const count = rows().length
        const page = Math.max(1, Math.floor((scroll?.clientHeight ?? 0) / ROW_HEIGHT) - 1)
        const keys: Record<string, () => void> = {
          ArrowDown: () => count && select(Math.min(selected() + 1, count - 1)),
          ArrowUp: () => count && select(Math.max(selected() - 1, 0)),
          PageDown: () => count && select(Math.min(selected() + page, count - 1)),
          PageUp: () => count && select(Math.max(selected() - page, 0)),
          Enter: () => pick(rows()[selected()]),
        }
        const action = keys[event.key]
        if (!action) return
        event.preventDefault()
        action()
      }

      let input: HTMLInputElement | undefined
      requestAnimationFrame(() => {
        input?.focus()
        if (scroll && sentinel) {
          observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void more(), {
            root: scroll,
            rootMargin: `${ROW_HEIGHT * 4}px`,
          })
          observer.observe(sentinel)
        }
      })
      void search(props.initial)

      return (
        <ui.Dialog title="Pull requests" description={scope()} size="large">
          <div data-component="list" data-gh-pr onKeyDown={onKeyDown}>
            <div data-slot="list-search-wrapper">
              <div data-slot="list-search">
                <div data-slot="list-search-container">
                  <Show when={searching()} fallback={<ui.Icon name="magnifying-glass" size="small" />}>
                    <ui.Loader size="small" />
                  </Show>
                  <input
                    ref={input}
                    data-slot="list-search-input"
                    type="text"
                    placeholder="[repo] title or #number, e.g. api login"
                    value={text()}
                    onInput={(event) => onInput(event.currentTarget.value)}
                    spellcheck={false}
                    autocomplete="off"
                  />
                </div>
              </div>
            </div>
            <div data-slot="list-scroll" ref={scroll}>
              <Show when={rows().length === 0}>
                <div data-slot="list-empty-state">
                  <div data-slot="list-message">{error() || (searching() || indexing() ? "Searching…" : "No pull requests")}</div>
                </div>
              </Show>
              <div data-slot="list-group">
                <div data-slot="list-items">
                  <For each={rows()}>
                    {(pull, index) => (
                      <div
                        data-slot="list-item"
                        data-active={index() === selected()}
                        onClick={() => pick(pull)}
                        onMouseMove={() => setSelected(index())}
                      >
                        <span class="gh-pr-state-cell">
                          <span class="gh-pr-state" data-state={pull.state}>
                            <span innerHTML={states[pull.state]?.icon ?? ""} style={{ display: "contents" }} />
                            {states[pull.state]?.label ?? pull.state}
                          </span>
                        </span>
                        <span class="gh-pr-main">
                          <span class="gh-pr-line">
                            <span class="gh-pr-title">{pull.title}</span>
                            <Show when={pull.stack}>
                              {(stack) => (
                                <span
                                  class="gh-pr-weak gh-pr-stack"
                                  title={
                                    `Stack ${stack().position} of ${stack().size}` +
                                    (stack().parent ? `, on top of #${stack().parent}` : "")
                                  }
                                >
                                  <span innerHTML={STACK_ICON} style={{ display: "contents" }} />
                                  {stack().position}/{stack().size}
                                </span>
                              )}
                            </Show>
                          </span>
                          <span class="gh-pr-meta">
                            #{pull.number}
                            {many() ? ` · ${pull.repo.split("/").pop()}` : ""}
                            {pull.author ? ` · ${pull.author}` : ""}
                            {when(pull) ? ` · ${when(pull)}` : ""}
                          </span>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
                <div ref={sentinel} class="gh-pr-more">
                  <Show when={loadingMore()}>
                    <ui.Loader size="small" />
                    <span>Loading more…</span>
                  </Show>
                  <Show when={!loadingMore() && indexing()}>
                    <ui.Loader size="small" />
                    <span>Indexing pull requests…</span>
                  </Show>
                  <Show when={!loadingMore() && error() && rows().length > 0}>
                    <span>{error()}</span>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </ui.Dialog>
      )
    }

    ctx.add(
      Command,
      (): Command => ({
        id: "pick",
        title: "Attach a GitHub pull request",
        description: "/pr [repo] [query]",
        keywords: "github pull request pr",
        group: "GitHub",
        section: "prompt",
        slash: { name: "pr", arguments: true },
        enabled: !!ctx.sessions.current(),
        run: (input) => {
          const session = ctx.sessions.current()
          if (!session) return
          ctx.dialogs.open((dialog) => <Search directory={session.directory} initial={input ?? ""} dialog={dialog} />)
        },
      }),
    )
  },
})
