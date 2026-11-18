import { Rpc } from "@opencode/plugin/rpc"

export interface Repo {
  name: string
  dir: string
}

export interface Resolved {
  /** The repos to search: the session's repo, the repos matching the short name, or every repo in the folder. */
  repos: Repo[]
  /** The search query left after the repo short name. */
  query: string
}

export interface Pull {
  number: number
  title: string
  state: string
  /** owner/name */
  repo: string
  author: string
  branch: string
  /** ISO dates. */
  createdAt: string
  mergedAt?: string
  closedAt?: string
  /** The branch the PR merges into. */
  base: string
  url: string
  /** Set when the PR is part of a stack of open PRs: position from the bottom, and the stack's size. */
  stack?: { position: number; size: number; parent?: number }
}

/** Where the next batch starts in the sorted local results. */
export interface Cursor {
  offset: number
}

export interface Pulls {
  /** owner/name of every repo searched. */
  repos: string[]
  pulls: Pull[]
  /** Matches in the local index, across all batches. */
  total: number
  /** A repo's index is still being synced, so results may grow. */
  indexing: boolean
  next?: Cursor
}

const str = { type: "string" }

export const GhPr = Rpc.define({
  id: "gh-pr",
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
    pulls: {
      input: {
        type: "object",
        properties: {
          dirs: { type: "array", items: str },
          query: str,
          size: { type: "integer", minimum: 1, maximum: 100 },
          cursor: { type: "object" },
        },
        required: ["dirs", "query", "size"],
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
