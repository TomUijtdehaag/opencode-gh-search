/** @jsxImportSource @opentui/solid */
import { createSignal, For, onCleanup, Show } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { KINDS, empty, highlight, meta, mine, status, placeholder, scope, type Item, type Kind } from "./rpc.js"
import { createSearch } from "./search.js"

const BATCH = 100
// Terminal lines the dialog needs besides the rows: its margins and frame, the header, the search box and gaps.
const CHROME = 16
// Rows shown at most; more makes the dialog taller than the host places it.
const MAX_ROWS = 12
// GitHub's Primer colours for the theme's light or dark mode: state text and review pill backgrounds
// (`emphasis`, under white text). The theme has no matching tokens.
const GITHUB = {
  light: {
    state: { open: "#1a7f37", draft: "#59636e", merged: "#8250df", closed: "#d1242f", issueClosed: "#8250df" },
    pill: { attention: "#9a6700", danger: "#cf222e", success: "#1f883d", neutral: "#59636e" },
  },
  dark: {
    state: { open: "#3fb950", draft: "#9198a1", merged: "#ab7df8", closed: "#f85149", issueClosed: "#ab7df8" },
    pill: { attention: "#9e6a03", danger: "#da3633", success: "#238636", neutral: "#656c76" },
  },
}
const PILL_TEXT = "#ffffff"
// Stands in for the Desktop stack octicon; a plain BMP character, so any terminal font has it.
const STACK = "≡"

function Search(props: { kind: Kind; directory: string; initial: string; onPick: (item: Item) => void }) {
  const ctx = usePlugin()
  const theme = ctx.theme
  const github = () => GITHUB[ctx.themeMode]
  const stateColor = (item: Item) =>
    github().state[item.kind === "issue" && item.state === "closed" ? "issueClosed" : (item.state as "open")]
  const kind = KINDS[props.kind]
  const s = createSearch({
    solid: { createSignal, onCleanup },
    client: ctx.client,
    kind: props.kind,
    directory: props.directory,
    initial: props.initial,
    batch: BATCH,
  })
  const label = (item: Item) => kind.states[item.state] ?? item.state
  const width = Math.max(...Object.values(kind.states).map((label) => label.length))
  const terminal = useTerminalDimensions()
  // As many two-line rows as fit the terminal, up to MAX_ROWS.
  const fit = () => Math.max(3, Math.min(MAX_ROWS, Math.floor((terminal().height - CHROME) / 2)))

  // OpenCode's own dialog navigation commands, so the user's configured keys apply (default up/ctrl+p,
  // down/ctrl+n, pageup, pagedown). Like the host's dialogs, they live in the `modal` input mode.
  ctx.keymap.layer(() => ({
    mode: "modal",
    priority: 10,
    commands: [
      { id: "dialog.select.prev", run: () => s.move(-1, fit()) },
      { id: "dialog.select.next", run: () => s.move(1, fit()) },
      { id: "dialog.select.page_up", run: () => s.move(-fit(), fit()) },
      { id: "dialog.select.page_down", run: () => s.move(fit(), fit()) },
    ],
  }))

  const start = () => Math.max(0, Math.min(s.selected() - Math.floor(fit() / 2), s.rows().length - fit()))
  const visible = () => s.rows().slice(start(), start() + fit())
  const message = () => empty(kind.plural, { error: s.error(), searching: s.searching(), indexing: s.indexing() })

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base}>
          <b>{kind.title}</b>
        </text>
        <text fg={theme.text.muted}>
          {scope(s.repos(), s.error())}
          {s.indexing() ? ` · indexing ${kind.plural}…` : ""}
        </text>
      </box>
      <input
        focused
        value={s.text()}
        placeholder={placeholder(props.kind)}
        onInput={s.input}
        onSubmit={() => {
          const item = s.current()
          if (item) props.onPick(item)
        }}
      />
      <box flexDirection="column" height={fit() * 2}>
        <Show when={s.rows().length > 0} fallback={<text fg={theme.text.muted}>{message()}</text>}>
          <For each={visible()}>
            {(item, index) => {
              const active = () => start() + index() === s.selected()
              const fg = () => (active() ? theme.text.action.primary.state({ selected: true }) : theme.text.base)
              const weak = () => (active() ? fg() : theme.text.muted)
              return (
                <box
                  flexDirection="row"
                  gap={2}
                  height={2}
                  backgroundColor={active() ? theme.background.action.primary.state({ selected: true }) : undefined}
                  onMouseDown={() => props.onPick(item)}
                >
                  <text fg={active() ? fg() : stateColor(item)} flexShrink={0}>
                    {label(item).padEnd(width)}
                  </text>
                  <box flexDirection="column" flexGrow={1}>
                    <box flexDirection="row" gap={2}>
                      <text fg={fg()} wrapMode="none" flexShrink={1} flexGrow={1}>
                        <For each={highlight(item.title, s.text(), props.kind)}>
                          {(part) => (part.hit ? <b>{part.text}</b> : part.text)}
                        </For>
                      </text>
                      <Show when={status(item, s.viewer())}>
                        {(st) => (
                          <text fg={PILL_TEXT} bg={github().pill[st().tone || "neutral"]} wrapMode="none" flexShrink={0}>
                            {` ${st().label} `}
                          </text>
                        )}
                      </Show>
                    </box>
                    <box flexDirection="row">
                      <text fg={weak()} wrapMode="none" flexShrink={1}>
                        {meta(item, s.many()).before}
                        <Show when={mine(item, s.viewer())} fallback={meta(item, s.many()).author}>
                          <b>{meta(item, s.many()).author}</b>
                        </Show>
                        {meta(item, s.many()).after}
                      </text>
                      <Show when={item.stack}>
                        {(stack) => (
                          <text fg={weak()} wrapMode="none" flexShrink={0}>
                            {` · ${STACK} ${stack().position}/${stack().size}`}
                          </text>
                        )}
                      </Show>
                    </box>
                  </box>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "gh-search",
  setup(ctx) {
    // The TUI has no prompt API for plugins; the dialog returns focus to the prompt, so type into it directly.
    function insert(text: string, noun: string) {
      const focused = ctx.renderer.currentFocusedRenderable as { insertText?: (text: string) => void } | null
      if (typeof focused?.insertText === "function") {
        focused.insertText(text)
        ctx.renderer.requestRender()
        return
      }
      ctx.renderer.copyToClipboardOSC52(text)
      ctx.ui.toast.show({ message: `Copied ${noun} to the clipboard`, variant: "info" })
    }

    function open(kind: Kind, input: string) {
      const directory = (ctx.location ?? ctx.data.location.default()).directory
      const onPick = (item: Item) => {
        ctx.ui.dialog.clear()
        setTimeout(() => insert(`${item.url} `, KINDS[kind].noun), 0)
      }
      ctx.ui.dialog.show(() => <Search kind={kind} directory={directory} initial={input.trim()} onPick={onPick} />)
      ctx.ui.dialog.set({ size: "xlarge" })
    }

    ctx.keymap.layer(() => ({
      mode: "global",
      commands: (Object.keys(KINDS) as Kind[]).map((kind) => ({
        id: `gh-search.${kind}`,
        title: `Attach a GitHub ${KINDS[kind].noun}`,
        description: `/${KINDS[kind].command} [@repo] [query]`,
        group: "GitHub",
        palette: true,
        slash: { name: KINDS[kind].command, arguments: true },
        run: (input?: string) => open(kind, input ?? ""),
      })),
    }))
  },
})
