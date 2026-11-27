# pi-deepseek-search

**中文** | [English](./README.md)

一个 [Pi](https://pi.dev) 扩展，基于 [DeepSeek Search API](https://api-docs.deepseek.com/zh-cn/guides/search) 提供联网搜索工具：

- **`search`** —— 联网搜索，返回排序后的结果（标题 / 链接 / 站点 / 日期 / 摘要），可选返回网页正文。

工具带自定义 TUI 渲染（紧凑结果列表，`ctrl+o` 展开详情）。

## 安装

```bash
pi install npm:@bainianzzz/pi-deepseek-search
```

也可以从 GitHub 安装（git 源）：

```bash
pi install git:github.com/Bainianzzz/pi-deepseek-search
```

安装后重启 Pi，或执行 `/reload`。

## 配置

API Key 在每次调用时解析，优先级从高到低：

1. `DEEPSEEK_SEARCH_API_KEY`
2. `DEEPSEEK_API_KEY`（已配好 DeepSeek 模型 provider 时无需任何额外配置）
3. `models.json` 中任意 `baseUrl` 域名以 `deepseek.com` 结尾的 provider 的 `apiKey`

请求地址固定走官方 Endpoint，不可配置：

| 工具 | URL |
|---|---|
| `search` | `POST https://api.deepseek.com/v1/tools/search` |

> `models.json` 会从 `$PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）和当前目录下的 `./.pi/models.json` 读取。

## 工具说明

`search` 的参数、搜索语法、返回字段与错误码，见官方文档：

- 中文：https://api-docs.deepseek.com/zh-cn/guides/search
- English：https://api-docs.deepseek.com/guides/search

## 行为说明

- 对 `408 / 429 / 5xx` 自动重试，指数退避，最多 3 次，并支持工具级取消（abort）。
- HTTP 错误会映射为可读信息（`402 余额不足`、`429 触发限流` 等）。
- 每次调用都会重新读取 API Key，修改环境变量或 `models.json` 后无需重启。
- 请求地址固定为官方 Endpoint（`https://api.deepseek.com/v1/tools/search`），不提供 base URL 覆盖。

### 为什么不集成 fetch 服务

DeepSeek 还提供 `fetch` 接口（抓取单个 URL 的正文），但本扩展不集成它：抓取由 DeepSeek 服务端完成，经常受防火墙影响导致工具报错 404：

```
DeepSeek API HTTP 404 (no usable page content could be retrieved): failed to fetch URL
```

404 是一个兜底码，页面不存在、站点拒绝访问、内容类型不支持、正文提取为空都返回同一句 `failed to fetch URL`，无法区分。

## 目录结构

```
pi-deepseek-search/
├── extensions/
│   ├── index.ts             # 扩展本体（注册 search 工具）
│   ├── utils.ts             # API 调用、结果格式化
│   ├── render.ts            # TUI 渲染组件
│   └── types.ts             # 共享类型（无本地依赖）
├── package.json             # pi manifest + peerDependencies
├── tsconfig.json
└── LICENSE
```

host 提供的包（`@earendil-works/pi-*`、`typebox`）按 Pi 打包规则声明为 `peerDependencies: "*"`，不放进 `dependencies`。

## 开发

```bash
npm install
npm run typecheck
```

## 许可证

MIT
