# pi-deepseek-search

[中文](./README.md) | **English**

A [Pi](https://pi.dev) extension that adds two web tools powered by the
[DeepSeek Search / Fetch API](https://api-docs.deepseek.com/guides/search):

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
2. `DEEPSEEK_API_KEY` (no extra setup needed if a DeepSeek model provider is already configured)
3. the `apiKey` of any provider in `models.json` whose `baseUrl` host ends with `deepseek.com`

Request URLs are fixed to the official endpoints and are not configurable:

| tool | URL |
|---|---|
| `search` | `POST https://api.deepseek.com/v1/tools/search` |
| `fetch` | `POST https://api.deepseek.com/v1/tools/fetch` |

> `models.json` is read from `$PI_CODING_AGENT_DIR` (default `~/.pi/agent`) and from `./.pi/models.json`.

## Tools

Parameters, search operators, response fields and error codes for `search` and `fetch` are documented upstream:

- English: https://api-docs.deepseek.com/guides/search
- 中文: https://api-docs.deepseek.com/zh-cn/guides/search

## Behaviour notes

- Retries on `408 / 429 / 5xx` with exponential backoff (3 attempts), abortable via the tool signal.
- HTTP errors are mapped to readable messages (`402 insufficient balance`, `403 fetch rejected by security policy`, …).
- The API key is re-read on every call, so changing env vars or `models.json` does not require a reload.
- Request URLs are pinned to the official endpoints (`https://api.deepseek.com/v1/tools/{search,fetch}`); there is no base URL override.

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
