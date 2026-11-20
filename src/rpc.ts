import { Rpc } from "@opencode/plugin/rpc"

export type Kind = "pr" | "issue"

/** Everything that differs between pull requests and issues. The UIs and the server read it from here. */
export const KINDS: Record<
  Kind,
  {
    /** Slash command name. */
    command: string
    title: string
    noun: string
    plural: string
    /** Display labels for each state, in sort order. */
    states: Record<string, string>
  }
> = {
  pr: {
    command: "pr",
    title: "Pull requests",
    noun: "pull request",
    plural: "pull requests",
    states: { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" },
  },
  issue: {
    command: "issue",
    title: "Issues",
    noun: "issue",
    plural: "issues",
    states: { open: "Open", closed: "Closed" },
  },
}

export interface Repo {
  name: string
  dir: string
}

export interface Resolved {
  /** The repos to search: the session's repo, the repos matching `@short`, or every repo in the folder. */
  repos: Repo[]
  /** The search query left after `@short`. */
  query: string
}

/** A pull request or an issue. */
export interface Item {
  kind: Kind
  number: number
  title: string
  state: string
  /** owner/name */
  repo: string
  author: string
  url: string
  labels: string[]
  assignees: string[]
  /** ISO dates. */
  createdAt: string
  mergedAt?: string
  closedAt?: string
  /** Pull requests only: the source and target branch. */
  branch?: string
  base?: string
  /** Pull requests only: GitHub's review decision, and who a review is still requested from (users or team slugs). */
  review?: "approved" | "changes_requested" | "review_required" | "none"
  reviewers?: string[]
  /** Pull requests only: each reviewer's latest review state (`approved`, `changes_requested`, `commented`…). */
  reviews?: Record<string, string>
  /** Pull requests only: which of the reviewers in `reviews` are bot accounts. */
  bots?: string[]
  /** Pull requests only: GitHub reported it as mergeable (`CLEAN`). Often unknown until someone opens the PR. */
  mergeable?: boolean
  /** Pull requests only: set when part of a stack of open PRs: position from the bottom, and the stack's size. */
  stack?: { position: number; size: number; parent?: number }
}

/** Where the next batch starts in the sorted local results. */
export interface Cursor {
  offset: number
}

export interface Page {
  /** owner/name of every repo searched. */
  repos: string[]
  items: Item[]
  /** Matches in the local index, across all batches. */
  total: number
  /** A repo's index is still being synced, so results may grow. */
  indexing: boolean
  /** The signed-in user; an empty login if unknown. */
  viewer: Viewer
  /** Why a repo's index couldn't be synced. */
  error?: string
  next?: Cursor
}

const has = (value: string | undefined, part: string) => !!value && value.toLowerCase().includes(part)
const same = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()

/** The signed-in user, and their teams as `org/slug`. */
export interface Viewer {
  login: string
  teams: string[]
}

/** A login filter value: `@me` is exactly you, anything else a partial login. */
const person = (login: string | undefined, value: string, viewer: Viewer) =>
  value === "@me" ? same(login, viewer.login) : has(login, value)

/**
 * Whether a review is requested from you directly, or only from a team you are on. Like GitHub, a team request
 * counts as yours until the team (or its auto-assignment) hands it to specific members.
 */
export function requested(item: Item, viewer: Viewer): "you" | "team" | "" {
  if (!viewer.login || !item.reviewers) return ""
  if (item.reviewers.some((r) => same(r, viewer.login))) return "you"
  const org = item.repo.split("/")[0]
  if (item.reviewers.some((r) => viewer.teams.some((team) => same(team, `${org}/${r}`)))) return "team"
  return ""
}

/**
 * The GitHub-style `key:value` filters: which kinds they apply to, how they match, and the example shown in
 * the search box. The single source for parsing, matching and the placeholder text.
 */
const FILTERS: Record<string, { kinds: Kind[]; example: string; test: (item: Item, value: string, viewer: Viewer) => boolean }> = {
  author: { kinds: ["pr", "issue"], example: "author:tom", test: (item, value, viewer) => person(item.author, value, viewer) },
  is: {
    kinds: ["pr", "issue"],
    example: "is:open",
    // A prefix is enough (`is:merg`). As on GitHub, drafts are open.
    test: (item, value) => ("open".startsWith(value) && item.state === "draft") || item.state.startsWith(value),
  },
  label: { kinds: ["pr", "issue"], example: "label:bug", test: (item, value) => item.labels.some((l) => has(l, value)) },
  assignee: {
    kinds: ["pr", "issue"],
    example: "assignee:tom",
    test: (item, value, viewer) => item.assignees.some((login) => person(login, value, viewer)),
  },
  base: { kinds: ["pr"], example: "base:main", test: (item, value) => has(item.base, value) },
  head: { kinds: ["pr"], example: "head:feat", test: (item, value) => has(item.branch, value) },
  // GitHub's values (`approved`, `changes_requested`, `required`, `none`), by prefix: `review:changes`.
  review: {
    kinds: ["pr"],
    example: "review:approved",
    test: (item, value) => !!item.review && (item.review.startsWith(value) || item.review.startsWith(`review_${value}`)),
  },
  "review-requested": {
    kinds: ["pr"],
    example: "review-requested:tom",
    test: (item, value, viewer) =>
      value === "@me" ? !!requested(item, viewer) : !!item.reviewers?.some((login) => has(login, value)),
  },
}

const ALIASES: Record<string, string> = { state: "is" }

/** The search box hint: the syntax by example. */
export function placeholder(kind: Kind): string {
  const filters = Object.values(FILTERS).filter((filter) => filter.kinds.includes(kind))
  return ["@repo", "text", "#12", ...filters.map((filter) => filter.example), "-exclude"].join("  ")
}

/** A search term: free text, or a `key:value` filter. A leading `-` negates it. */
interface Term {
  key: string
  value: string
  negate: boolean
}

/** Filters that don't apply to `kind`, and unknown ones, are searched as text. */
export function parseQuery(query: string, kind: Kind): Term[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw): Term => {
      const negate = raw.length > 1 && raw.startsWith("-")
      const word = negate ? raw.slice(1) : raw
      const [name, ...rest] = word.split(":")
      const key = ALIASES[name] ?? name
      const value = rest.join(":")
      if (value && FILTERS[key]?.kinds.includes(kind)) return { key, value, negate }
      return { key: "text", value: word, negate }
    })
}

function test(item: Item, term: Term, viewer: Viewer): boolean {
  if (term.key !== "text") return FILTERS[term.key].test(item, term.value, viewer)
  const number = String(item.number)
  if (term.value.startsWith("#")) return number.includes(term.value.slice(1))
  return has(item.title, term.value) || (/^\d+$/.test(term.value) && number.includes(term.value))
}

/**
 * How many text terms match exactly rather than partially: the whole number (`#700`, `700`), or a whole word
 * of the title. Results with more exact matches come first, so `#700` lists #700 before #5700.
 */
export function exactness(item: Item, terms: Term[]): number {
  const words = new Set(item.title.toLowerCase().split(/[^\p{L}\p{N}]+/u))
  const number = String(item.number)
  return terms.filter((term) => {
    if (term.key !== "text" || term.negate) return false
    const value = term.value.startsWith("#") ? term.value.slice(1) : term.value
    return value === number || (!term.value.startsWith("#") && words.has(value))
  }).length
}

/**
 * Text terms must appear in the title or number (partial matches count; `#74` only matches numbers).
 * Repeated qualifiers of one kind are alternatives (`is:open is:draft`); different kinds must all hold.
 * Negated terms must not match.
 */
export function matches(item: Item, terms: Term[], viewer: Viewer): boolean {
  const any = new Map<string, boolean>()
  for (const term of terms) {
    const hit = test(item, term, viewer)
    if (term.negate) {
      if (hit) return false
    } else if (term.key === "text") {
      if (!hit) return false
    } else {
      any.set(term.key, (any.get(term.key) ?? false) || hit)
    }
  }
  return [...any.values()].every(Boolean)
}

/**
 * Splits `title` into parts, marking where the query's text terms match, so the UIs can highlight them. Uses the
 * same rules as matching: free-text words, case-insensitive, partial; filters, `#numbers` and `-excludes` aren't
 * highlighted. A leading `@repo` is skipped.
 */
export function highlight(title: string, query: string, kind: Kind): { text: string; hit: boolean }[] {
  const words = parseQuery(query.trim().replace(/^@\S*\s*/, ""), kind)
    .filter((term) => term.key === "text" && !term.negate && !term.value.startsWith("#"))
    .map((term) => term.value)
  const lower = title.toLowerCase()
  const marked = new Array<boolean>(title.length).fill(false)
  for (const word of words)
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length))
      marked.fill(true, at, at + word.length)
  const parts: { text: string; hit: boolean }[] = []
  for (let i = 0; i < title.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.hit === marked[i]) last.text += title[i]
    else parts.push({ text: title[i], hit: marked[i] })
  }
  return parts
}

/** Exact name, then `*-<short>`, then substring. The first tier with matches wins. */
export function matchRepos<T>(repos: T[], name: (repo: T) => string, short: string): T[] {
  const s = short.toLowerCase()
  const tiers = [
    (n: string) => n === s,
    (n: string) => n.endsWith(`-${s}`),
    (n: string) => n.includes(s),
  ]
  for (const tier of tiers) {
    const hits = repos.filter((repo) => tier(name(repo).toLowerCase()))
    if (hits.length > 0) return hits
  }
  return []
}

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
export function ago(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return "just now"
}

/** GitHub's wording: what last happened to the item, and when. */
export function when(item: Item): string {
  if (item.mergedAt) return `merged ${ago(item.mergedAt)}`
  if (item.closedAt) return `closed ${ago(item.closedAt)}`
  return item.createdAt ? `opened ${ago(item.createdAt)}` : ""
}

/** You opened it. */
export function mine(item: Item, viewer: Viewer): boolean {
  return same(item.author, viewer.login)
}

/**
 * An open PR's review status, in GitHub's words, from your point of view; the first that applies wins. Only direct
 * requests count as yours: team requests are left out, since team auto-assignment hands them to specific members.
 * `attention` is waiting on you; `danger` is GitHub's red for changes requested; `success` needs nothing more from
 * reviews. Ignored reviewers (bots, by default) are already left out of `reviews` by the server.
 */
export function status(item: Item, viewer: Viewer): { label: string; tone: "attention" | "danger" | "success" | "" } | undefined {
  if (item.state !== "open" && item.state !== "draft") return undefined
  const reviews = Object.entries(item.reviews ?? {})
  const own = reviews.find(([login]) => same(login, viewer.login))?.[1]
  const yours = mine(item, viewer)
  if (requested(item, viewer) === "you") return { label: "Review requested", tone: "attention" }
  if (item.review === "changes_requested") return { label: "Changes requested", tone: "danger" }
  if (item.mergeable) return { label: "Ready to merge", tone: "success" }
  if (own === "approved") return { label: "You approved", tone: "success" }
  if (item.review === "approved") return { label: "Approved", tone: "success" }
  // On your own PR, your comment-only "reviews" are replies; what matters is someone else commenting.
  if (yours && reviews.some(([login, state]) => !same(login, viewer.login) && state === "commented"))
    return { label: "Reviewed", tone: "attention" }
  if (!yours && own === "commented") return { label: "You reviewed", tone: "" }
  return undefined
}

/**
 * The second row line: `#number · repo · author when`, e.g. `#818 · benmezger opened last week`, with the repo only
 * when several are searched; the UIs append the stack position. Split around the author so it can be highlighted.
 */
export function meta(item: Item, many: boolean): { before: string; author: string; after: string } {
  const join = (parts: string[]) => parts.filter(Boolean).join(" · ")
  const before = join([`#${item.number}`, many ? item.repo.split("/").pop() ?? "" : ""])
  const after = when(item)
  if (!item.author) return { before: join([before, after]), author: "", after: "" }
  return { before: `${before} · `, author: item.author, after: after ? ` ${after}` : "" }
}

/** The empty list's message. "Searching…" only while a query is in flight; an unfinished index still says so. */
export function empty(plural: string, state: { error: string; searching: boolean; indexing: boolean }): string {
  if (state.error) return state.error
  if (state.searching) return "Searching…"
  return state.indexing ? `No ${plural} yet, still indexing…` : `No ${plural}`
}

/** The header's scope line. */
export function scope(repos: string[], error: string): string {
  if (repos.length === 1) return repos[0]
  if (repos.length > 1) return `${repos.length} repositories`
  return error ? "No repositories" : "Searching…"
}

const str = { type: "string" }

export const GhSearch = Rpc.define({
  id: "gh-search",
  methods: {
    resolve: {
      input: {
        type: "object",
        properties: { directory: str, input: str },
        required: ["directory", "input"],
        additionalProperties: false,
      },
      output: { type: "object" },
    },
    search: {
      input: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["pr", "issue"] },
          dirs: { type: "array", items: str },
          query: str,
          size: { type: "integer", minimum: 1, maximum: 100 },
          cursor: { type: "object" },
        },
        required: ["kind", "dirs", "query", "size"],
        additionalProperties: false,
      },
      output: { type: "object" },
      errors: {
        gh_failed: {
          type: "object",
          properties: { message: str },
          required: ["message"],
          additionalProperties: false,
        },
      },
    },
  },
  events: {},
})
