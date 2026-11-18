import { execFile } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"
import { GhPr, type Cursor, type Pull, type Pulls, type Repo, type Resolved } from "./rpc.js"

const run = promisify(execFile)

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

function childRepos(dir: string): Repo[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, ".git")))
    .map((entry) => ({ name: entry.name, dir: join(dir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Exact name, then `*-<short>`, then substring. The first tier with matches wins. */
function match(repos: Repo[], short: string): Repo[] {
  const s = short.toLowerCase()
  const tiers = [
    (name: string) => name === s,
    (name: string) => name.endsWith(`-${s}`),
    (name: string) => name.includes(s),
  ]
  for (const tier of tiers) {
    const hits = repos.filter((repo) => tier(repo.name.toLowerCase()))
    if (hits.length > 0) return hits
  }
  return []
}

async function resolve(directory: string, input: string): Promise<Resolved> {
  const text = input.trim()
  const root = await repoRoot(directory)
  if (root) return { repos: [{ name: basename(root), dir: root }], query: text }

  const repos = childRepos(directory)
  const [first = "", ...rest] = text.split(/\s+/)
  const hits = first ? match(repos, first) : []
  if (hits.length > 0) return { repos: hits, query: rest.join(" ") }
  return { repos, query: text }
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

async function githubToken(): Promise<string> {
  if (!token) token = (await run("gh", ["auth", "token"], { env })).stdout.trim()
  return token
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${await githubToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  if (response.status === 401) token = undefined
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] }
  if (!body.data) throw new Error(body.errors?.map((e) => e.message).join("; ") || `GitHub ${response.status}`)
  return body.data
}

// GitHub search only matches whole words, so each repo's PRs are kept in a local index and searched here.
// The first sync pages through every PR; later syncs stop at the first PR not updated since the last one.

const CACHE_DIR = join(homedir(), ".cache", "opencode-gh-pr")
const RESYNC_MS = 60_000

// Bump when the stored fields change, so old caches are fetched again in full.
const INDEX_VERSION = 3

interface Index {
  version?: number
  pulls: Record<number, Pull>
  /** Every PR has been fetched once. */
  complete: boolean
  /** Where the first full sync continues after an interruption. */
  resume?: string
  /** updatedAt of the newest PR seen by the last finished sync. */
  synced?: string
}

const indexes = new Map<string, Index>()
const syncing = new Map<string, Promise<void>>()
const lastSync = new Map<string, number>()

function cacheFile(repo: string) {
  return join(CACHE_DIR, `${repo.replace("/", "__")}.json`)
}

async function load(repo: string): Promise<Index> {
  let index = indexes.get(repo)
  if (index) return index
  try {
    index = JSON.parse(await readFile(cacheFile(repo), "utf8")) as Index
    if (index.version !== INDEX_VERSION) index = { version: INDEX_VERSION, pulls: index.pulls, complete: false }
  } catch {
    index = { version: INDEX_VERSION, pulls: {}, complete: false }
  }
  indexes.set(repo, index)
  return index
}

async function save(repo: string, index: Index) {
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile(repo), JSON.stringify(index))
}

const PAGE = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number title url state isDraft updatedAt headRefName baseRefName createdAt mergedAt closedAt author { login } }
    }
  }
}`

interface PageNode {
  number: number
  title: string
  url: string
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  updatedAt: string
  headRefName: string
  baseRefName: string
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
  author: { login: string } | null
}

async function sync(repo: string): Promise<void> {
  const index = await load(repo)
  const [owner, name] = repo.split("/")
  let after = index.complete ? undefined : index.resume
  let newest: string | undefined
  let pages = 0
  for (;;) {
    const data = await graphql<{
      repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: PageNode[] } }
    }>(PAGE, { owner, name, after })
    const { nodes, pageInfo } = data.repository.pullRequests
    let reachedSynced = false
    for (const pr of nodes) {
      newest ??= pr.updatedAt
      if (index.complete && index.synced && pr.updatedAt <= index.synced) {
        reachedSynced = true
        break
      }
      index.pulls[pr.number] = {
        number: pr.number,
        title: pr.title,
        state: pr.state === "OPEN" && pr.isDraft ? "draft" : pr.state.toLowerCase(),
        repo,
        author: pr.author?.login ?? "",
        branch: pr.headRefName,
        base: pr.baseRefName,
        url: pr.url,
        createdAt: pr.createdAt,
        ...(pr.mergedAt ? { mergedAt: pr.mergedAt } : {}),
        ...(pr.closedAt && !pr.mergedAt ? { closedAt: pr.closedAt } : {}),
      }
    }
    pages++
    if (reachedSynced || !pageInfo.hasNextPage) break
    after = pageInfo.endCursor
    if (!index.complete) index.resume = after
    if (pages % 5 === 0) await save(repo, index)
  }
  if (!index.complete || !index.synced || (newest && newest > index.synced)) index.synced = newest ?? index.synced
  index.complete = true
  index.resume = undefined
  await save(repo, index)
}

/** Starts a sync when none is running and the last one is older than RESYNC_MS. */
function refresh(repo: string) {
  if (syncing.has(repo) || Date.now() - (lastSync.get(repo) ?? 0) < RESYNC_MS) return
  lastSync.set(repo, Date.now())
  const running = sync(repo)
    .catch(() => void lastSync.delete(repo))
    .finally(() => syncing.delete(repo))
  syncing.set(repo, running)
}

const rank: Record<string, number> = { open: 0, draft: 1, merged: 2, closed: 3 }

/** Every word must appear in the title or the number; `#74` only matches numbers. Partial matches count. */
function matches(pull: Pull, words: string[]): boolean {
  const title = pull.title.toLowerCase()
  const number = String(pull.number)
  return words.every((word) => {
    if (word.startsWith("#")) return number.includes(word.slice(1))
    return title.includes(word) || (/^\d+$/.test(word) && number.includes(word))
  })
}

const active = (pull: Pull) => pull.state === "open" || pull.state === "draft"

/** A stack is a chain of open PRs where each one is based on the branch of the one below it. */
function withStacks(index: Index): Pull[] {
  const list = Object.values(index.pulls)
  const byBranch = new Map(list.filter(active).map((pull) => [pull.branch, pull]))
  const parent = (pull: Pull) => (active(pull) ? byBranch.get(pull.base) : undefined)
  const children = new Map<number, Pull[]>()
  for (const pull of list) {
    const below = parent(pull)
    if (below) children.set(below.number, [...(children.get(below.number) ?? []), pull])
  }
  const height = (pull: Pull, seen = new Set<number>()): number => {
    if (seen.has(pull.number)) return 0
    seen.add(pull.number)
    return 1 + Math.max(0, ...(children.get(pull.number) ?? []).map((child) => height(child, seen)))
  }
  return list.map((pull) => {
    const below = parent(pull)
    if (!below && !children.has(pull.number)) return pull
    let position = 1
    let root = pull
    const seen = new Set([pull.number])
    for (let p = parent(root); p && !seen.has(p.number); p = parent(root)) {
      seen.add(p.number)
      root = p
      position++
    }
    const stack: Pull["stack"] = { position, size: height(root) }
    if (below) stack.parent = below.number
    return { ...pull, stack }
  })
}

async function pulls(dirs: string[], query: string, size: number, start?: Cursor): Promise<Pulls> {
  const repos = [...new Set((await Promise.all(dirs.map(nameWithOwner))).filter(Boolean))]
  repos.forEach(refresh)
  const indexed = await Promise.all(repos.map(load))
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const all = indexed
    .flatMap(withStacks)
    .filter((pull) => matches(pull, words))
    .sort((a, b) => rank[a.state] - rank[b.state] || b.number - a.number || a.repo.localeCompare(b.repo))
  const offset = start?.offset ?? 0
  const page = all.slice(offset, offset + size)
  const result: Pulls = { repos, pulls: page, total: all.length, indexing: repos.some((repo) => syncing.has(repo)) }
  if (offset + size < all.length) result.next = { offset: offset + size }
  return result
}

export default Plugin.define({
  id: "gh-pr",
  async setup(ctx) {
    const registration = await ctx.rpc.register(GhPr, {
      resolve: async (input) => {
        const { directory, input: text } = input as { directory: string; input: string }
        return resolve(directory, text)
      },
      pulls: async (input, context) => {
        const { dirs, query, size, cursor } = input as { dirs: string[]; query: string; size: number; cursor?: Cursor }
        try {
          return await pulls(dirs, query, size, cursor)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return context.error("gh_failed", "gh pr list failed", { message })
        }
      },
    })
    return () => registration.dispose()
  },
})
