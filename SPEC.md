# /pr and /issue behaviour spec

The Desktop (`src/gui.tsx`) and terminal (`src/tui.tsx`) UIs must behave the same. Everything here applies to both, and to both commands unless noted. A change to one UI that touches this list must be made in the other too, or recorded under [Known differences](#known-differences).

To keep them on par, shared behaviour lives outside the UIs:

- `src/index.ts` (server): which repos, syncing, matching, sorting.
- `src/rpc.ts`: kinds (`KINDS`), filters (`FILTERS`), the placeholder, row meta line, header scope, dates.
- `src/search.ts`: the dialog's state (debounce, `@repo` resolution, paging, re-polling while indexing).

The UIs only render and handle keys. Neither filters or sorts results on its own.

## Commands

| Command | Searches | Dialog title |
|---|---|---|
| `/pr [text]` | pull requests | Pull requests |
| `/issue [text]` | issues | Issues |

`[text]` is put in the search box and searched. Both commands are also in the command palette ("Attach a GitHub pull request / issue").

## Which repos are searched

1. If the session's folder is inside a git repo: only that repo.
2. Otherwise: every repo up to three folder levels down, without descending into repos or hidden folders.
3. A leading `@name` narrows to repos matching `name`: an exact name, else names ending in `-name`, else names containing `name`. `@name` that matches nothing gives no results and a "No repository matches @name" message.
4. A first word without `@` is always a search term, never a repo.

## Query syntax

Words are separated by spaces and are case-insensitive. Filters are defined once in `FILTERS` (`src/rpc.ts`), which also generates the search box placeholder.

| Term | Matches | Applies to |
|---|---|---|
| `word` | title contains `word`; a bare number also matches numbers | both |
| `#74` | number contains `74` | both |
| `author:x` | author login contains `x` | both |
| `is:x` | state starts with `x` (`is:merg`); `is:open` includes drafts; `state:` is an alias | both |
| `label:x` | a label contains `x` | both |
| `assignee:x` | an assignee's login contains `x` | both |
| `base:x` / `head:x` | target / source branch contains `x` | PRs |
| `review:x` | review decision starts with `x`: `approved`, `changes` (requested), `required`, `none` | PRs |
| `review-requested:x` | a pending reviewer's login or team slug contains `x` | PRs |
| `-term` | excludes items matching `term` | both |

`@me` as a filter value is the signed-in GitHub user (`author:@me`, `assignee:@me`). As on GitHub, `review-requested:@me` also matches requests to a team you are on (teams need the `read:org` scope).

Text terms must all match. Repeated filters of one kind are alternatives (`is:open is:merged`); different kinds must all hold. A filter that doesn't apply to the command, or an unknown `key:value`, is searched as text.

## Results

- States: PRs are Open, Draft, Merged, Closed; issues are Open, Closed. Sorted in that order, then newest number first.
- Header shows the scope (`scope()`): the repo's `owner/name` for one repo, "N repositories" for several, "No repositories" for none. While a repo's index is still syncing, results refresh automatically and an indexing notice is shown.
- Each row shows:
  - the state, first
  - the first line: the title, then the review status pill. Parts of the title matching the query's text words are highlighted (`highlight()`): GitHub's yellow search highlight behind the text on Desktop, bold in the TUI.
  - a second line: `meta()`, `#number · repo · author opened/merged/closed <relative date>` (e.g. `#818 · benmezger opened last week`), with the repo only when several repos are searched, then ` · n/m` with a stack icon (`≡` in the TUI) for PRs in a stack of open PRs, and your name highlighted when you opened it (`mine()`)
  - for open and draft PRs, the review status from `status()`, as a pill at the end of the first line (filled block in the TUI), the first that applies:
    1. **Review requested** (orange): your review is requested directly. Team requests don't count, since team auto-assignment hands them to specific members.
    2. **Changes requested** (red, as on GitHub).
    3. **Ready to merge** (green): GitHub reports the PR as mergeable (`CLEAN`). Fetched separately for open PRs on each refresh, because it's slow to compute and changes with CI.
    4. **You approved** (green): your latest review approved it.
    5. **Approved** (green): GitHub's review decision is approved.
    6. **Reviewed** (orange, your own PR): someone else's latest review only left comments. Your own replies don't count.
    7. **You reviewed** (grey, someone else's PR): your latest review only left comments.

    Reviews by bots (e.g. Copilot) are left out, unless the `ignoreBotReviews` option is `false`; `ignoreReviewers` lists more logins to leave out.
- More results load as the selection or scroll nears the end.
- Empty states (`empty()`): "Searching…" only while a query is in flight; then "No pull requests" / "No issues", or "No … yet, still indexing…" while a repo is syncing, or the error message. A failed sync shows its error instead of indexing forever.

## Keys

Up/Down move, Page Up/Page Down jump a page, Enter or click picks, Escape closes. The TUI uses OpenCode's `dialog.select.*` commands, so a user's own bindings for those (by default also Ctrl+P/Ctrl+N) apply.

## Picking

The item's URL is the only context given to the model.

- Desktop: attaches a chip labelled `repo#number` with the title; its content is the URL.
- TUI: types `<url> ` into the prompt (TUI plugins can't add chips). If the prompt can't be reached, copies it to the clipboard.

## Known differences

- Desktop shows the state as GitHub's lists do: only the octicon, in GitHub's light or dark state colour (the label is its tooltip). The TUI shows the state as text in the same colours, picked by the theme's light or dark mode.
- Desktop's dialog is `large`; the TUI's is `xlarge`, to fit the repo name.
- The TUI shows as many rows as fit the terminal's height, up to 12; Desktop's list scrolls.
