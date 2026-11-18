# opencode-gh-pr-search

An [OpenCode](https://opencode.ai) Desktop plugin that adds `/pr`: a live search for GitHub pull requests. Pick one and it is attached to your prompt as context.

- **Partial matching** on titles and PR numbers (`depen`, `#74`). GitHub's own search only matches whole words.
- **Multiple repos.** Run it from a folder that holds several repos and it searches all of them, or narrow with a short repo name: `/pr api login` searches `acme-api` only.
- **Sorted** open → draft → merged → closed, newest first, with GitHub's state labels.
- **Stacks.** Open PRs based on another open PR's branch show their position, e.g. `2/3`.
- **Fast.** Each repo's PRs are kept in a local index (`~/.cache/opencode-gh-pr-search/`) that updates incrementally in the background, so searching takes milliseconds.

## Requirements

- OpenCode Desktop 2.2 or later (the GUI plugin API is experimental and may change)
- [`gh`](https://cli.github.com) logged in (`gh auth login`); the plugin uses its token
- Node.js and npm to build

## Install

```sh
git clone https://github.com/TomUijtdehaag/opencode-gh-pr-search.git
cd opencode-gh-pr-search
npm install
npm run build
```

Add the folder to your global `~/.config/opencode/opencode.json` (Desktop only loads plugin UIs from the global config):

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-gh-pr-search"]
}
```

## Usage

| Where | Command | Searches |
| --- | --- | --- |
| inside a repo | `/pr login` | that repo |
| folder with repos | `/pr login` | every repo in the folder |
| folder with repos | `/pr api login` | repos matching `api` (exact, then `*-api`, then containing) |
| anywhere | `/pr #42` | PR numbers containing 42 |

Arrow keys to select, Enter to attach, scroll for more. The attached chip tells the model the repo, number, title, state, branch, author and URL; it can fetch details with `gh`.

The terminal UI is not supported: TUI plugins cannot add context to the prompt yet.

## Development

`src/index.ts` runs in the OpenCode server (index, search), `src/gui.tsx` in the Desktop window (dialog, chip), `src/rpc.ts` is the contract between them. Run `npm run dev` to rebuild the GUI on change; Desktop reloads it automatically.

## License

MIT. Includes GitHub [Octicons](https://github.com/primer/octicons) (MIT).
