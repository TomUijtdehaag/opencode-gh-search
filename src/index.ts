import { execFile } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"
import { GhSearch, exactness, matches, matchRepos, parseQuery, type Cursor, type Item, type Kind, type Page, type Repo, type Resolved, type Viewer } from "./rpc.js"

const exec = promisify(execFile)
// A hung git or gh (e.g. waiting on a credential prompt) would otherwise leave the dialog searching forever.
const run = (file: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) =>
  exec(file, args, { ...options, timeout: 10_000 })
const REQUEST_MS = 30_000

// The desktop app's server may not inherit the login shell's PATH.
const env = {
  ...process.env,
  PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":"),
}

async function repoRoot(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir, env })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

/** Repos under `dir`, descending into folders that are not repos themselves, up to `depth` levels. */
function childRepos(dir: string, depth = 3): Repo[] {
  const repos: Repo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    const path = join(dir, entry.name)
    if (existsSync(join(path, ".git"))) repos.push({ name: entry.name, dir: path })
    else if (depth > 1) repos.push(...childRepos(path, depth - 1))
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name))
}

async function resolve(directory: string, input: string): Promise<Resolved> {
  const text = input.trim()
  const root = await repoRoot(directory)
  if (root) return { repos: [{ name: basename(root), dir: root }], query: text }

  const repos = childRepos(directory)
  const [first = "", ...rest] = text.split(/\s+/)
  if (!first.startsWith("@") || first.length < 2) return { repos, query: text }
  return { repos: matchRepos(repos, (repo) => repo.name, first.slice(1)), query: rest.join(" ") }
}

const names = new Map<string, string>()

async function nameWithOwner(dir: string): Promise<string> {
  try {
    return await lookupName(dir)
  } catch {
    return ""
  }
}

async function lookupName(dir: string): Promise<string> {
  const cached = names.get(dir)
  if (cached) return cached
  // Read from the origin remote: much faster than `gh repo view` when searching many repos.
  const { stdout } = await run("git", ["remote", "get-url", "origin"], { cwd: dir, env })
  const name = stdout.trim().match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/)?.[1] ?? ""
  names.set(dir, name)
  return name
}

let token: string | undefined

/** `gh` is missing or not logged in. Not specific to a repo, so it's shown once instead of per repo. */
class GhUnavailable extends Error {}

async function githubToken(): Promise<string> {
  if (token) return token
  try {
    token = (await run("gh", ["auth", "token"], { env })).stdout.trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new GhUnavailable("GitHub CLI not found. Install gh from https://cli.github.com, then run `gh auth login`.")
    throw new GhUnavailable("Not logged in to the GitHub CLI. Run `gh auth login`.")
  }
  if (!token) throw new GhUnavailable("Not logged in to the GitHub CLI. Run `gh auth login`.")
  return token
}

/** GitHub asked us to slow down (secondary rate limit, or the hourly quota ran out). */
class RateLimited extends Error {
  constructor(readonly retryMs: number) {
    super(`GitHub rate limit; retrying in ${Math.ceil(retryMs / 1000)}s`)
  }
}

// GitHub's secondary rate limit trips on bursts of concurrent requests, e.g. syncing every repo in a folder at once.
const MAX_CONCURRENT = 2
let running = 0
const waiting: (() => void)[] = []

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await request<T>(query, variables)
  } finally {
    running--
    waiting.shift()?.()
  }
}

async function request<T>(query: string, variables: Record<string, unknown>, attempt = 0): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${await githubToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_MS),
  })
  if (response.status === 401) token = undefined
  // Heavy pages can time out with a non-JSON 502/504 page; retry those a couple of times.
  if (response.status >= 500 && attempt < 2) return request(query, variables, attempt + 1)
  if (response.status === 403 || response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"))
    const reset = Number(response.headers.get("x-ratelimit-reset"))
    const exhausted = response.headers.get("x-ratelimit-remaining") === "0"
    // GitHub's guidance: honour retry-after, else wait for the reset when the quota is spent, else a minute.
    const ms = retryAfter ? retryAfter * 1000 : exhausted && reset ? reset * 1000 - Date.now() : 60_000
    const text = await response.text()
    if (retryAfter || exhausted || /rate limit/i.test(text)) throw new RateLimited(Math.max(ms, 1000))
    throw new Error(`GitHub ${response.status}: ${messageOf(text) ?? response.statusText}`)
  }
  const text = await response.text()
  let body: { data?: T; errors?: { message: string }[] }
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`GitHub ${response.status} ${response.statusText}`.trim())
  }
  if (!body.data) throw new Error(body.errors?.map((e) => e.message).join("; ") || `GitHub ${response.status}`)
  return body.data
}

function messageOf(text: string): string | undefined {
  try {
    return (JSON.parse(text) as { message?: string }).message
  } catch {
    return undefined
  }
}

const VIEWER_MS = 10 * 60_000
let current: { at: number; viewer: Promise<Viewer> } | undefined

/**
 * The signed-in GitHub user and their teams, for `@me` and the row highlights. Teams come from every org you're
 * in (needs the `read:org` scope; without it, team requests just don't count as yours).
 */
function viewer(): Promise<Viewer> {
  if (current && Date.now() - current.at < VIEWER_MS) return current.viewer
  type Data = {
    viewer: { login: string; organizations: { nodes: { login: string; teams: { nodes: { slug: string }[] } }[] } }
  }
  // Every search waits for this, so it skips the queue that index syncs fill on a cold start.
  const lookup = async (): Promise<Viewer> => {
    const { login } = (await request<{ viewer: { login: string } }>("query { viewer { login } }", {})).viewer
    try {
      const data = await request<Data>(
        `query($login: String!) { viewer { login organizations(first: 100) { nodes { login
          teams(first: 100, userLogins: [$login]) { nodes { slug } } } } } }`,
        { login },
      )
      const teams = data.viewer.organizations.nodes.flatMap((org) => org.teams.nodes.map((t) => `${org.login}/${t.slug}`))
      return { login, teams }
    } catch {
      return { login, teams: [] }
    }
  }
  const entry = { at: Date.now(), viewer: lookup() }
  current = entry
  entry.viewer.catch(() => {
    if (current === entry) current = undefined
  })
  return entry.viewer.catch(() => ({ login: "", teams: [] }))
}

// GitHub search only matches whole words, so each repo's PRs and issues are kept in a local index and searched here.
// The first sync pages through every item; later syncs stop at the first item not updated since the last one.

const CACHE_DIR = join(homedir(), ".cache", "opencode-gh-search")
const RESYNC_MS = 60_000
const RETRY_MS = 15_000

// Bump when the stored fields change, so old caches are fetched again in full.
const INDEX_VERSION = 7

interface Index {
  version?: number
  items: Record<number, Item>
  /** Every item has been fetched once. */
  complete: boolean
  /** Where the first full sync continues after an interruption. */
  resume?: string
  /** updatedAt of the newest item seen by the last finished sync. */
  synced?: string
}

interface Node {
  number: number
  title: string
  url: string
  state: string
  updatedAt: string
  createdAt: string
  closedAt: string | null
  author: { login: string } | null
  labels: { nodes: { name: string }[] }
  assignees: { nodes: { login: string }[] }
  isDraft?: boolean
  headRefName?: string
  baseRefName?: string
  mergedAt?: string | null
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  latestReviews?: { nodes: { author: { login: string; __typename: string } | null; state: string }[] }
  reviewRequests?: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] }
}

const COMMON = "number title url state updatedAt createdAt closedAt author { login } labels(first: 20) { nodes { name } } assignees(first: 10) { nodes { login } }"

/** How each kind is fetched from GitHub's GraphQL API. */
const SOURCES: Record<Kind, { connection: string; fields: string }> = {
  pr: { connection: "pullRequests", fields: `${COMMON} isDraft headRefName baseRefName mergedAt reviewDecision latestReviews(first: 20) { nodes { author { login __typename } state } } reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }` },
  issue: { connection: "issues", fields: COMMON },
}

function toItem(kind: Kind, repo: string, node: Node): Item {
  const state = node.state === "OPEN" && node.isDraft ? "draft" : node.state.toLowerCase()
  return {
    kind,
    number: node.number,
    title: node.title,
    state,
    repo,
    author: node.author?.login ?? "",
    url: node.url,
    labels: node.labels.nodes.map((label) => label.name),
    assignees: node.assignees.nodes.map((user) => user.login),
    createdAt: node.createdAt,
    ...(node.mergedAt ? { mergedAt: node.mergedAt } : {}),
    ...(node.closedAt && !node.mergedAt ? { closedAt: node.closedAt } : {}),
    ...(kind === "pr"
      ? {
          branch: node.headRefName,
          base: node.baseRefName,
          review: (node.reviewDecision?.toLowerCase() ?? "none") as Item["review"],
          reviews: Object.fromEntries(
            (node.latestReviews?.nodes ?? []).filter((r) => r.author).map((r) => [r.author!.login, r.state.toLowerCase()]),
          ),
          bots: (node.latestReviews?.nodes ?? []).filter((r) => r.author?.__typename === "Bot").map((r) => r.author!.login),
          reviewers: (node.reviewRequests?.nodes ?? [])
            .map(({ requestedReviewer: r }) => r?.login ?? r?.slug ?? "")
            .filter(Boolean),
        }
      : {}),
  }
}

const indexes = new Map<string, Promise<Index>>()
const syncing = new Map<string, Promise<void>>()
// When each index may sync next: RESYNC_MS after a sync, later after an error.
const nextSync = new Map<string, number>()
const syncErrors = new Map<string, string>()

const key = (kind: Kind, repo: string) => `${kind}:${repo}`

function cacheFile(kind: Kind, repo: string) {
  return join(CACHE_DIR, `${repo.replace("/", "__")}.${kind}.json`)
}

/** One shared index per kind and repo, so a sync and concurrent searches see the same object. */
function load(kind: Kind, repo: string): Promise<Index> {
  let index = indexes.get(key(kind, repo))
  if (!index) {
    index = read(kind, repo)
    indexes.set(key(kind, repo), index)
  }
  return index
}

async function read(kind: Kind, repo: string): Promise<Index> {
  try {
    const index = JSON.parse(await readFile(cacheFile(kind, repo), "utf8")) as Index
    if (index.version === INDEX_VERSION) return index
    // An older format: keep showing its items while a full sync replaces them.
    return { version: INDEX_VERSION, items: index.items ?? {}, complete: false }
  } catch {}
  return { version: INDEX_VERSION, items: {}, complete: false }
}

async function save(kind: Kind, repo: string, index: Index) {
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile(kind, repo), JSON.stringify(index))
}

async function sync(kind: Kind, repo: string): Promise<void> {
  const index = await load(kind, repo)
  const { connection, fields } = SOURCES[kind]
  const query = `query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      ${connection}(first: 50, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { ${fields} }
      }
    }
  }`
  const [owner, name] = repo.split("/")
  let after = index.complete ? undefined : index.resume
  let newest: string | undefined
  let pages = 0
  for (;;) {
    type Connection = { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Node[] }
    const data = await graphql<{ repository: Record<string, Connection> }>(query, { owner, name, after })
    const { nodes, pageInfo } = data.repository[connection]
    let reachedSynced = false
    for (const node of nodes) {
      newest ??= node.updatedAt
      if (index.complete && index.synced && node.updatedAt <= index.synced) {
        reachedSynced = true
        break
      }
      const mergeable = index.items[node.number]?.mergeable
      index.items[node.number] = { ...toItem(kind, repo, node), ...(mergeable !== undefined ? { mergeable } : {}) }
    }
    pages++
    if (reachedSynced || !pageInfo.hasNextPage) break
    after = pageInfo.endCursor
    if (!index.complete) index.resume = after
    if (pages % 5 === 0) await save(kind, repo, index)
  }
  if (!index.complete || !index.synced || (newest && newest > index.synced)) index.synced = newest ?? index.synced
  index.complete = true
  index.resume = undefined
  if (kind === "pr") await syncMergeable(repo, index)
  await save(kind, repo, index)
}

/**
 * Whether each open PR is ready to merge. Kept out of the main sync: GitHub computes it per PR, which makes large
 * pages time out, and it changes with CI without touching `updatedAt`. Best effort: a failure keeps the last values.
 */
async function syncMergeable(repo: string, index: Index) {
  const query = `query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 20, after: $after, states: OPEN) {
        pageInfo { hasNextPage endCursor }
        nodes { number mergeStateStatus }
      }
    }
  }`
  const [owner, name] = repo.split("/")
  try {
    for (let after: string | undefined; ; ) {
      type Connection = { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { number: number; mergeStateStatus: string }[] }
      const data = await graphql<{ repository: { pullRequests: Connection } }>(query, { owner, name, after })
      const { nodes, pageInfo } = data.repository.pullRequests
      for (const node of nodes) {
        const item = index.items[node.number]
        // UNKNOWN means GitHub hasn't computed it yet; keep what we had.
        if (item && node.mergeStateStatus !== "UNKNOWN") item.mergeable = node.mergeStateStatus === "CLEAN"
      }
      if (!pageInfo.hasNextPage) break
      after = pageInfo.endCursor
    }
  } catch {}
}

/** Starts a sync when none is running and its next sync time has come. */
function refresh(kind: Kind, repo: string) {
  const k = key(kind, repo)
  if (syncing.has(k) || Date.now() < (nextSync.get(k) ?? 0)) return
  nextSync.set(k, Date.now() + RESYNC_MS)
  const job = sync(kind, repo)
    .then(() => void syncErrors.delete(k))
    .catch((error) => {
      // Back off instead of retrying on the next keystroke; a first sync resumes where it stopped.
      if (error instanceof RateLimited) {
        nextSync.set(k, Date.now() + error.retryMs)
        syncErrors.set(k, `Indexing ${repo} paused: ${error.message}`)
        return
      }
      nextSync.set(k, Date.now() + RETRY_MS)
      if (error instanceof GhUnavailable) {
        syncErrors.set(k, error.message)
        return
      }
      syncErrors.set(k, `Indexing ${repo} failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => syncing.delete(k))
  syncing.set(k, job)
}

const rank: Record<string, number> = { open: 0, draft: 1, merged: 2, closed: 3 }

const active = (item: Item) => item.state === "open" || item.state === "draft"

/** A stack is a chain of open PRs where each one is based on the branch of the one below it. */
function withStacks(index: Index): Item[] {
  const list = Object.values(index.items)
  const byBranch = new Map(list.filter(active).map((item) => [item.branch, item]))
  const parent = (item: Item) => (active(item) && item.base ? byBranch.get(item.base) : undefined)
  const children = new Map<number, Item[]>()
  for (const item of list) {
    const below = parent(item)
    if (below) children.set(below.number, [...(children.get(below.number) ?? []), item])
  }
  const height = (item: Item, seen = new Set<number>()): number => {
    if (seen.has(item.number)) return 0
    seen.add(item.number)
    return 1 + Math.max(0, ...(children.get(item.number) ?? []).map((child) => height(child, seen)))
  }
  return list.map((item) => {
    const below = parent(item)
    if (!below && !children.has(item.number)) return item
    let position = 1
    let root = item
    const seen = new Set([item.number])
    for (let p = parent(root); p && !seen.has(p.number); p = parent(root)) {
      seen.add(p.number)
      root = p
      position++
    }
    const stack: Item["stack"] = { position, size: height(root) }
    if (below) stack.parent = below.number
    return { ...item, stack }
  })
}

/** Plugin options from `opencode.json`. */
interface Settings {
  /** Leave out reviews by bot accounts (e.g. Copilot) from the review status. Default true. */
  ignoreBotReviews: boolean
  /** Further reviewer logins to leave out, e.g. a CI account that isn't a GitHub App. */
  ignoreReviewers: string[]
}

let settings: Settings = { ignoreBotReviews: true, ignoreReviewers: [] }

/** Drops ignored reviewers from an item's reviews. The index keeps them, so changing the settings needs no resync. */
function withoutIgnored(item: Item): Item {
  if (!item.reviews) return item
  const ignored = new Set([
    ...settings.ignoreReviewers.map((login) => login.toLowerCase()),
    ...(settings.ignoreBotReviews ? (item.bots ?? []).map((login) => login.toLowerCase()) : []),
  ])
  if (ignored.size === 0) return item
  return { ...item, reviews: Object.fromEntries(Object.entries(item.reviews).filter(([login]) => !ignored.has(login.toLowerCase()))) }
}

async function search(kind: Kind, dirs: string[], query: string, size: number, start?: Cursor): Promise<Page> {
  const repos = [...new Set((await Promise.all(dirs.map(nameWithOwner))).filter(Boolean))]
  repos.forEach((repo) => refresh(kind, repo))
  const indexed = await Promise.all(repos.map((repo) => load(kind, repo)))
  const me = await viewer()
  const terms = parseQuery(query, kind)
  const all = indexed
    .flatMap((index) => (kind === "pr" ? withStacks(index) : Object.values(index.items)))
    .filter((item) => matches(item, terms, me))
    .map((item) => ({ item, exact: exactness(item, terms) }))
    .sort(
      (a, b) =>
        b.exact - a.exact ||
        rank[a.item.state] - rank[b.item.state] ||
        b.item.number - a.item.number ||
        a.item.repo.localeCompare(b.item.repo),
    )
    .map(({ item }) => item)
  const offset = start?.offset ?? 0
  const items = all.slice(offset, offset + size).map(withoutIgnored)
  const indexing = repos.some((repo) => syncing.has(key(kind, repo)))
  const errors = [...new Set(repos.map((repo) => syncErrors.get(key(kind, repo))).filter((e): e is string => !!e))]
  const result: Page = { repos, items, total: all.length, indexing, viewer: me }
  if (errors.length) result.error = errors.join("; ")
  if (offset + size < all.length) result.next = { offset: offset + size }
  return result
}

export default Plugin.define({
  id: "gh-search",
  async setup(ctx) {
    settings = {
      ignoreBotReviews: ctx.options.ignoreBotReviews !== false,
      ignoreReviewers: Array.isArray(ctx.options.ignoreReviewers) ? ctx.options.ignoreReviewers.map(String) : [],
    }
    const registration = await ctx.rpc.register(GhSearch, {
      resolve: async (input) => {
        const { directory, input: text } = input as { directory: string; input: string }
        return resolve(directory, text)
      },
      search: async (input, context) => {
        const { kind, dirs, query, size, cursor } = input as {
          kind: Kind
          dirs: string[]
          query: string
          size: number
          cursor?: Cursor
        }
        try {
          return await search(kind, dirs, query, size, cursor)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return context.error("gh_failed", "GitHub search failed", { message })
        }
      },
    })
    return () => registration.dispose()
  },
})
