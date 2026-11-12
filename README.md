# pi-deepseek-search

A [Pi](https://pi.dev) extension that adds two web tools powered by the
[DeepSeek Search / Fetch API](https://api-docs.deepseek.com/zh-cn/guides/search):

- **`search`** — query the live web, returns ranked results (title / url / site / date / summary), with optional full page content.
- **`fetch`** — fetch a single URL and return its title plus main content as Markdown.

Both tools ship with a custom TUI renderer (compact result list, `ctrl+o` to expand).

## Install

```bash
# from GitHub (git source)
pi install git:github.com/Bainianzzz/pi-deepseek-search

# or from npm
pi install npm:pi-deepseek-search

# try it for a single run without installing
pi -e git:github.com/Bainianzzz/pi-deepseek-search
```

Then restart Pi (or run `/reload`).

## Configure

The API key is resolved on every call, first match wins:

1. `DEEPSEEK_SEARCH_API_KEY`
2. `DEEPSEEK_API_KEY`
3. the `apiKey` of any provider in `<agent-dir>/models.json` whose `baseUrl` host ends with `deepseek.com`

The base URL is resolved as:

1. `DEEPSEEK_SEARCH_BASE_URL` (origin only, e.g. `https://api.deepseek.com`)
2. the origin of the matching provider `baseUrl` in `models.json`
3. `https://api.deepseek.com`

So if you already configured DeepSeek as a model provider, no extra setup is needed:

```bash
export DEEPSEEK_API_KEY=sk-...
pi
```

> `models.json` is read from `$PI_CODING_AGENT_DIR` (default `~/.pi/agent`) and from `./.pi/models.json`.

## Tools

### `search`

| parameter | type | description |
|---|---|---|
| `query` | string (required) | 1–128 chars. Supports operators: `site:`, `-site:`, `-keyword`, `-"phrase"`, `"phrase"`, `lang:zh,en`, `after:2025-01-01`, `before:2026` |
| `count` | integer 1–50 | number of results (default `10`) |
| `needContent` | boolean | also return page body text (default `false`) |
| `oriQuestion` | string | the user's original question, helps the engine understand intent |

Output is a ranked list with `title`, `url`, `site · date · score · authority`, an LLM summary, and — if `needContent` is set — truncated page content (8k chars per result, 60k total; the rest is dropped in favour of `fetch`).

### `fetch`

| parameter | type | description |
|---|---|---|
| `url` | string (required) | absolute `http(s)` URL, max 8192 chars |
| `maxChars` | integer 1000–200000 | max characters of Markdown returned (default `40000`) |

`fetch` cannot reach `localhost`, private hosts, or non-HTML resources.

## Behaviour notes

- Retries on `408 / 429 / 5xx` with exponential backoff (3 attempts), abortable via the tool signal.
- HTTP errors are mapped to readable messages (`402 insufficient balance`, `403 fetch rejected by security policy`, …).
- Config is re-read per call, so changing env vars or `models.json` does not require a reload.

## Package layout

```
pi-deepseek-search/
├── extensions/deepseek-search.ts   # the extension
├── package.json                    # pi manifest + peerDependencies
├── tsconfig.json
└── LICENSE
```

Host-provided packages (`@earendil-works/pi-*`, `typebox`) are declared as `peerDependencies` with `"*"`, per the Pi packaging rules.

## Development

```bash
npm install
npm run typecheck
```

## License

MIT
