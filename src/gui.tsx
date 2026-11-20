import { createSignal, For, onCleanup, Show } from "solid-js"
import { Command, LinkHandler, Plugin, Style, type DialogHandle } from "@opencode/plugin/gui"
import { KINDS, empty, highlight, meta, mine, status, placeholder, scope, type Item, type Kind } from "./rpc"
import { createSearch } from "./search"

const ROW_HEIGHT = 48

const STACK_ICON = "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-stack\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M7.122.392a1.75 1.75 0 0 1 1.756 0l5.003 2.902c.83.481.83 1.68 0 2.162L8.878 8.358a1.75 1.75 0 0 1-1.756 0L2.119 5.456a1.251 1.251 0 0 1 0-2.162ZM8.125 1.69a.248.248 0 0 0-.25 0l-4.63 2.685 4.63 2.685a.248.248 0 0 0 .25 0l4.63-2.685ZM1.601 7.789a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0L1.874 8.814A.75.75 0 0 1 1.6 7.789Zm0 3.5a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0l-5.248-3.044a.75.75 0 0 1-.273-1.025Z\"></path></svg>"

// GitHub octicons (MIT), inlined so the bundle stays small.
const PR_ICONS: Record<string, string> = {
  open: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-pull-request\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z\"></path></svg>",
  draft: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-pull-request-draft\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z\"></path></svg>",
  merged: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-merge\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z\"></path></svg>",
  closed: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-git-pull-request-closed\" aria-hidden=\"true\" data-component=\"Octicon\"><path d=\"M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z\"></path></svg>",
}
const ISSUE_ICONS: Record<string, string> = {
  open: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-issue-opened\" aria-hidden=\"true\"><path d=\"M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z\"></path></svg>",
  closed: "<svg version=\"1.1\" width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" class=\"octicon octicon-issue-closed\" aria-hidden=\"true\"><path d=\"M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z\"></path></svg>",
}
const ICONS: Record<Kind, Record<string, string>> = { pr: PR_ICONS, issue: ISSUE_ICONS }
const BATCH = 20


// The app's list markup (`data-component=list`) gives rows, search field and selection the host's styling.
// Only the state badge and pager are ours; GitHub's state colors are the one deliberate non-theme color.
const css = `
[data-gh-search] [data-slot=list-search-input] {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 0;
  color: var(--text-strong); font-family: var(--font-family-sans); font-size: var(--font-size-base, 14px);
  line-height: 20px;
}
[data-gh-search] [data-slot=list-search-input]::placeholder { color: var(--text-weak); }
[data-gh-search] [data-slot=list-item] { display: flex; gap: 8px; cursor: default; position: relative; }
[data-gh-search] .gh-search-title,
[data-gh-search] .gh-search-weak { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-gh-search] .gh-search-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
[data-gh-search] .gh-search-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* The stack's leading "· " already spaces it from the date; a full gap would read as a double space. */
[data-gh-search] .gh-search-line-meta { gap: 4px; }
[data-gh-search] .gh-search-title { flex: 1; }
[data-gh-search] .gh-search-meta {
  color: var(--text-weak); font-size: var(--font-size-small, 12px); font-weight: var(--font-weight-regular);
  line-height: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-gh-search] .gh-search-weak { color: var(--text-weak); font-weight: var(--font-weight-regular); flex-shrink: 0; }
/* The state as GitHub's lists show it: just the octicon, in the state's colour. */
[data-gh-search] .gh-search-state-cell { flex-shrink: 0; width: 16px; display: flex; padding-top: 2px; }
[data-gh-search] .gh-search-stack { display: inline-flex; align-items: center; gap: 3px; }
[data-gh-search] .gh-search-stack svg { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }
[data-gh-search] .gh-search-state { display: inline-flex; }
/* Review status: GitHub's Primer Label (outlined, no fill), with its light and dark colours. */
[data-gh-search] .gh-search-status {
  flex-shrink: 0; display: inline-flex; align-items: center; height: 18px; padding: 0 7px; box-sizing: border-box;
  border: 1px solid var(--gh-border); border-radius: 2em; color: var(--gh-fg);
  font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap;
  --gh-fg: #59636e; --gh-border: #d1d9e0;
}
[data-gh-search] .gh-search-status[data-tone=attention] { --gh-fg: #9a6700; --gh-border: #9a6700; }
[data-gh-search] .gh-search-status[data-tone=danger] { --gh-fg: #d1242f; --gh-border: #cf222e; }
[data-gh-search] .gh-search-status[data-tone=success] { --gh-fg: #1a7f37; --gh-border: #1a7f37; }
[data-gh-search][data-mode=dark] .gh-search-status { --gh-fg: #9198a1; --gh-border: #3d444d; }
[data-gh-search][data-mode=dark] .gh-search-status[data-tone=attention] { --gh-fg: #d29922; --gh-border: #9e6a03; }
[data-gh-search][data-mode=dark] .gh-search-status[data-tone=danger] { --gh-fg: #f85149; --gh-border: #da3633; }
[data-gh-search][data-mode=dark] .gh-search-status[data-tone=success] { --gh-fg: #3fb950; --gh-border: #238636; }
[data-gh-search] .gh-search-me { color: var(--text-strong); font-weight: var(--font-weight-medium, 500); }
/* Search hits: GitHub's search highlight (attention-muted background), since titles are already bold. */
[data-gh-search] .gh-search-hit { background: #fff8c5; color: inherit; border-radius: 2px; }
[data-gh-search][data-mode=dark] .gh-search-hit { background: rgba(187, 128, 9, 0.15); }
[data-gh-search] .gh-search-state svg { width: 16px; height: 16px; fill: currentColor; flex-shrink: 0; }
[data-gh-search] .gh-search-state[data-state=open] { color: #1a7f37; }
[data-gh-search] .gh-search-state[data-state=draft] { color: #59636e; }
[data-gh-search] .gh-search-state[data-state=merged] { color: #8250df; }
[data-gh-search] .gh-search-state[data-state=closed] { color: #d1242f; }
[data-gh-search] .gh-search-state[data-kind=issue][data-state=closed] { color: #8250df; }
[data-gh-search][data-mode=dark] .gh-search-state[data-state=open] { color: #3fb950; }
[data-gh-search][data-mode=dark] .gh-search-state[data-state=draft] { color: #9198a1; }
[data-gh-search][data-mode=dark] .gh-search-state[data-state=merged] { color: #ab7df8; }
[data-gh-search][data-mode=dark] .gh-search-state[data-state=closed] { color: #f85149; }
[data-gh-search][data-mode=dark] .gh-search-state[data-kind=issue][data-state=closed] { color: #ab7df8; }
/* Pinned to the dialog body (position: relative) so only the results scroll and the search stays on top. */
[data-gh-search][data-component=list] {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px; overflow: hidden;
  padding: 4px 16px 12px; box-sizing: border-box;
}
[data-gh-search] [data-slot=list-search-wrapper] { flex-shrink: 0; }
[data-gh-search] [data-slot=list-scroll] { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
[data-gh-search] [data-slot=list-item] { height: ${ROW_HEIGHT}px; box-sizing: border-box; }
[data-gh-search] .gh-search-more {
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

    function attach(item: Item) {
      const repo = item.repo
      const composer = ctx.screen.current()?.composer
      if (!composer) return
      composer.attach({
        type: "note",
        origin: ctx.id,
        commentID: crypto.randomUUID(),
        label: `${repo.split("/").pop()}#${item.number}`,
        subtitle: item.title,
        icon: "github",
        subject: item.url,
        comment: "",
        href: item.url,
      })
      composer.focus()
    }

    function Search(props: { kind: Kind; directory: string; initial: string; dialog: DialogHandle }) {
      const kind = KINDS[props.kind]
      let scroll: HTMLDivElement | undefined
      let sentinel: HTMLDivElement | undefined
      let observer: IntersectionObserver | undefined
      // A short first batch may not fill the list yet; keep loading while the end is still visible.
      const checkEnd = () =>
        queueMicrotask(() => {
          if (!scroll || !sentinel) return
          if (sentinel.getBoundingClientRect().top <= scroll.getBoundingClientRect().bottom + ROW_HEIGHT * 4) void s.more()
        })
      const s = createSearch({
        solid: { createSignal, onCleanup },
        client: ctx.client,
        kind: props.kind,
        directory: props.directory,
        initial: props.initial,
        batch: BATCH,
        onReset: () => {
          scroll?.scrollTo({ top: 0 })
          checkEnd()
        },
        onMore: checkEnd,
      })
      onCleanup(() => observer?.disconnect())

      function pick(item: Item | undefined) {
        if (!item) return
        props.dialog.close()
        attach(item)
      }

      function select(index: number) {
        s.setSelected(index)
        scroll?.querySelectorAll("[data-slot=list-item]")[index]?.scrollIntoView({ block: "nearest" })
      }

      function onKeyDown(event: KeyboardEvent) {
        const count = s.rows().length
        const page = Math.max(1, Math.floor((scroll?.clientHeight ?? 0) / ROW_HEIGHT) - 1)
        const keys: Record<string, () => void> = {
          ArrowDown: () => count && select(Math.min(s.selected() + 1, count - 1)),
          ArrowUp: () => count && select(Math.max(s.selected() - 1, 0)),
          PageDown: () => count && select(Math.min(s.selected() + page, count - 1)),
          PageUp: () => count && select(Math.max(s.selected() - page, 0)),
          Enter: () => pick(s.current()),
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
          observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void s.more(), {
            root: scroll,
            rootMargin: `${ROW_HEIGHT * 4}px`,
          })
          observer.observe(sentinel)
        }
      })

      return (
        <ui.Dialog title={kind.title} description={scope(s.repos(), s.error())} size="large">
          <div data-component="list" data-gh-search data-mode={ctx.appearance.mode()} onKeyDown={onKeyDown}>
            <div data-slot="list-search-wrapper">
              <div data-slot="list-search">
                <div data-slot="list-search-container">
                  <Show when={s.searching()} fallback={<ui.Icon name="magnifying-glass" size="small" />}>
                    <ui.Loader size="small" />
                  </Show>
                  <input
                    ref={input}
                    data-slot="list-search-input"
                    type="text"
                    placeholder={placeholder(props.kind)}
                    value={s.text()}
                    onInput={(event) => s.input(event.currentTarget.value)}
                    spellcheck={false}
                    autocomplete="off"
                  />
                </div>
              </div>
            </div>
            <div data-slot="list-scroll" ref={scroll}>
              <Show when={s.rows().length === 0}>
                <div data-slot="list-empty-state">
                  <div data-slot="list-message">
                    {empty(kind.plural, { error: s.error(), searching: s.searching(), indexing: s.indexing() })}
                  </div>
                </div>
              </Show>
              <div data-slot="list-group">
                <div data-slot="list-items">
                  <For each={s.rows()}>
                    {(item, index) => (
                      <div
                        data-slot="list-item"
                        data-active={index() === s.selected()}
                        onClick={() => pick(item)}
                        onMouseMove={() => s.setSelected(index())}
                      >
                        <span class="gh-search-state-cell">
                          <span
                            class="gh-search-state"
                            data-kind={item.kind}
                            data-state={item.state}
                            title={kind.states[item.state] ?? item.state}
                            aria-label={kind.states[item.state] ?? item.state}
                            innerHTML={ICONS[item.kind][item.state] ?? ""}
                          />
                        </span>
                        <span class="gh-search-main">
                          <span class="gh-search-line">
                            <span class="gh-search-title">
                              <For each={highlight(item.title, s.text(), props.kind)}>
                                {(part) => (part.hit ? <mark class="gh-search-hit">{part.text}</mark> : part.text)}
                              </For>
                            </span>
                            <Show when={status(item, s.viewer())}>
                              {(st) => (
                                <span class="gh-search-status" data-tone={st().tone || undefined}>
                                  {st().label}
                                </span>
                              )}
                            </Show>
                          </span>
                          <span class="gh-search-line gh-search-line-meta">
                            <span class="gh-search-meta">
                              {meta(item, s.many()).before}
                              <span classList={{ "gh-search-me": mine(item, s.viewer()) }}>{meta(item, s.many()).author}</span>
                              {meta(item, s.many()).after}
                            </span>
                            <Show when={item.stack}>
                              {(stack) => (
                                <span
                                  class="gh-search-weak gh-search-stack gh-search-meta"
                                  title={
                                    `Stack ${stack().position} of ${stack().size}` +
                                    (stack().parent ? `, on top of #${stack().parent}` : "")
                                  }
                                >
                                  {"· "}
                                  <span innerHTML={STACK_ICON} style={{ display: "contents" }} />
                                  {stack().position}/{stack().size}
                                </span>
                              )}
                            </Show>
                          </span>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
                <div ref={sentinel} class="gh-search-more">
                  <Show when={s.loadingMore()}>
                    <ui.Loader size="small" />
                    <span>Loading more…</span>
                  </Show>
                  <Show when={!s.loadingMore() && s.indexing()}>
                    <ui.Loader size="small" />
                    <span>Indexing {kind.plural}…</span>
                  </Show>
                  <Show when={!s.loadingMore() && s.error() && s.rows().length > 0}>
                    <span>{s.error()}</span>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </ui.Dialog>
      )
    }

    for (const id of Object.keys(KINDS) as Kind[]) {
      const kind = KINDS[id]
      ctx.add(
        Command,
        (): Command => ({
          id,
          title: `Attach a GitHub ${kind.noun}`,
          description: `/${kind.command} [@repo] [query]`,
          keywords: `github ${kind.noun} ${kind.command}`,
          group: "GitHub",
          section: "prompt",
          slash: { name: kind.command, arguments: true },
          run: (input) => {
            // Plugins get no session, directory or composer on the new-session screen, so there is nothing to attach to.
            const session = ctx.sessions.current()
            if (!session) {
              ctx.toast.show({
                title: `/${kind.command} needs a started session`,
                description: "Send a first message, then run it again.",
              })
              return
            }
            ctx.dialogs.open((dialog) => (
              <Search kind={id} directory={session.directory} initial={input ?? ""} dialog={dialog} />
            ))
          },
        }),
      )
    }
  },
})
