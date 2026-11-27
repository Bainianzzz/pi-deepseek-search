# pi-deepseek-search

[![npm version](https://img.shields.io/npm/v/%40bainianzzz%2Fpi-deepseek-search)](https://www.npmjs.com/package/@bainianzzz/pi-deepseek-search) [![pi package](https://img.shields.io/badge/pi-package-blueviolet)](https://pi.dev/packages/@bainianzzz/pi-deepseek-search)

[中文](./README.zh.md) | **English**

A [Pi](https://pi.dev) extension that adds a web search tool powered by the
[DeepSeek Search API](https://api-docs.deepseek.com/guides/search):

- **`search`** — query the live web, returns ranked results (title / url / site / date / summary), with optional full page content.

The tool ships with a custom TUI renderer (compact result list, `ctrl+o` to expand).

## Install

```bash
pi install npm:@bainianzzz/pi-deepseek-search
```

Or install from GitHub (git source):

```bash
pi install git:github.com/Bainianzzz/pi-deepseek-search
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

> `models.json` is read from `$PI_CODING_AGENT_DIR` (default `~/.pi/agent`) and from `./.pi/models.json`.

## Tools

Parameters, search operators, response fields and error codes for `search` are documented upstream:

- English: https://api-docs.deepseek.com/guides/search
- 中文: https://api-docs.deepseek.com/zh-cn/guides/search

## Behaviour notes

- Retries on `408 / 429 / 5xx` with exponential backoff (3 attempts), abortable via the tool signal.
- HTTP errors are mapped to readable messages (`402 insufficient balance`, `429 rate limit exceeded`, …).
- The API key is re-read on every call, so changing env vars or `models.json` does not require a reload.
- Request URLs are pinned to the official endpoint (`https://api.deepseek.com/v1/tools/search`); there is no base URL override.

### Why the fetch service is not integrated

DeepSeek also offers a `fetch` endpoint (retrieve the body of a single URL), but this extension does not integrate it: fetching runs server-side at DeepSeek and is often affected by firewalls, making the tool fail with 404:

```
DeepSeek API HTTP 404 (no usable page content could be retrieved): failed to fetch URL
```

404 is a catch-all — a missing page, a site refusing access, an unsupported content type and a page with no extractable body all return the identical `failed to fetch URL`, with no way to tell them apart.

## Package layout

```
pi-deepseek-search/
├── extensions/
│   ├── index.ts             # the extension (registers search)
│   ├── utils.ts             # API calls and result formatting
│   ├── render.ts            # TUI renderers
│   └── types.ts             # shared types (no local imports)
├── package.json             # pi manifest + peerDependencies
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
