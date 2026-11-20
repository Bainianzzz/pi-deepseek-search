/**
 * DeepSeek Search & Fetch tools
 *
 * Registers two web tools backed by DeepSeek's Search / Fetch API
 * (https://api-docs.deepseek.com/zh-cn/guides/search):
 *
 *   - search: query the web, returns title / url / summary (+ optional full content)
 *   - fetch:  fetch a single URL as Markdown
 *
 * API key resolution, first match wins:
 *   1. DEEPSEEK_SEARCH_API_KEY
 *   2. DEEPSEEK_API_KEY
 *   3. apiKey of a provider in <agent-dir>/models.json whose baseUrl host ends with deepseek.com
 *
 * Base URL: fixed to the official endpoint documented at
 * https://api-docs.deepseek.com/zh-cn/guides/search
 *   search: https://api.deepseek.com/v1/tools/search
 *   fetch:  https://api.deepseek.com/v1/tools/fetch
 *
 * Helpers (API plumbing, formatting, renderers) live in ./utils.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { FetchDetails, SearchDetails, SearchResult, StoredResult, ToolResult } from "./types.ts";
import { callApi, formatSearchResult } from "./utils.ts";
import { renderFetchCall, renderFetchResult, renderSearchCall, renderSearchResult } from "./render.ts";

export default function deepseekSearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "search",
		label: "Web Search",
		description:
			"Search the live web via DeepSeek Search and return ranked results (title, url, site, date, summary). " +
			"Supports operators in the query: site:, -site:, -, -\"phrase\", \"phrase\", lang:zh,en, after:2025-01-01, before:2026. " +
			"Use it for current events, up-to-date docs, releases, prices, or anything that may have changed. " +
			"Set needContent to true only when you need page bodies; otherwise follow up with the fetch tool on the best URLs.",
		promptSnippet: "Search the live web through DeepSeek Search (title/url/summary per result)",
		promptGuidelines: [
			"Use search when the answer may have changed since training or the user asks for current/latest information.",
			"Use fetch after search to read a specific result URL as Markdown instead of guessing page contents.",
		],
		parameters: Type.Object({
			query: Type.String({
				description:
					"Search query, 1-128 characters. Supports site:, -site:, -keyword, -\"phrase\", \"phrase\", lang:, after:, before:",
			}),
			count: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 50, description: "Number of results to return (default 10)" }),
			),
			needContent: Type.Optional(
				Type.Boolean({ description: "Return page body text in content for each result (default false)" }),
			),
			oriQuestion: Type.Optional(
				Type.String({ description: "The user's original question, helps the engine understand intent" }),
			),
		}),

		async execute(
			_toolCallId,
			params,
			signal,
		): Promise<ToolResult> {
			const query = (params.query ?? "").trim();
			if (!query) {
				return {
					content: [{ type: "text", text: "search requires a non-empty query" }],
					details: { kind: "search", query, results: [], error: "empty query" },
					isError: true,
				};
			}

			const body: Record<string, unknown> = { query, count: params.count ?? 10 };
			if (params.needContent) body.need_content = true;
			const oriQuestion = params.oriQuestion?.trim();
			if (oriQuestion) body.ori_question = oriQuestion;

			try {
				const data = await callApi<{ results?: SearchResult[] }>("search", body, signal);
				const results = data.results ?? [];

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: `No results for "${query}".` }],
						details: { kind: "search", query, results: [] },
					};
				}

				const text = formatSearchResult(query, results);
				const stored: StoredResult[] = results.map((result) => ({
					title: result.title,
					url: result.url,
					siteName: result.site_name,
					date: result.date,
					authority: result.authority,
					score: result.rerank_score,
					summaryChars: (result.summary || "").length,
					contentChars: (result.content || "").length,
				}));

				return {
					content: [{ type: "text", text }],
					details: { kind: "search", query, results: stored },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Search failed: ${message}` }],
					details: { kind: "search", query, results: [], error: message },
					isError: true,
				};
			}
		},

		renderCall(args, theme, context) {
			return renderSearchCall(args, theme, context);
		},

		renderResult(result, { expanded }, theme, context) {
			return renderSearchResult(result.details as SearchDetails | undefined, expanded, theme, context);
		},
	});

	pi.registerTool({
		name: "fetch",
		label: "Fetch URL",
		description:
			"Fetch a single web page via DeepSeek Fetch and return its title plus main content as Markdown. " +
			"Use it to read a URL found by search or given by the user instead of guessing page contents.",
		promptSnippet: "Fetch one web page as Markdown through DeepSeek Fetch",
		promptGuidelines: [
			"Use fetch with an http(s) URL to read a page as Markdown; it cannot reach localhost, private hosts, or non-HTML resources.",
			"Use fetch on at most a few of the best search results; prefer search summaries when the answer is already clear.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL to fetch (max 8192 chars)" }),
		}),

		async execute(
			_toolCallId,
			params,
			signal,
		): Promise<ToolResult> {
			const url = (params.url ?? "").trim();
			let parsed: URL | undefined;
			try {
				parsed = new URL(url);
			} catch {
				parsed = undefined;
			}
			if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
				return {
					content: [{ type: "text", text: `fetch requires an absolute http(s) URL, got: ${url || "(empty)"}` }],
					details: { kind: "fetch", url, title: "", contentChars: 0, error: "invalid url" },
					isError: true,
				};
			}

			try {
				const data = await callApi<{ title?: string; content?: string }>("fetch", { url }, signal);
				const title = data.title ?? "";
				const content = data.content ?? "";

				const header = [`# ${title || url}`, `Source: ${url}`, ""].join("\n");
				return {
					content: [{ type: "text", text: header + content }],
					details: {
						kind: "fetch",
						url,
						title,
						contentChars: content.length,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Fetch failed for ${url}: ${message}` }],
					details: {
						kind: "fetch",
						url,
						title: "",
						contentChars: 0,
						error: message,
					},
					isError: true,
				};
			}
		},

		renderCall(args, theme, context) {
			return renderFetchCall(args, theme, context);
		},

		renderResult(result, { expanded }, theme, context) {
			return renderFetchResult(result.details as FetchDetails | undefined, expanded, theme, context);
		},
	});
}
