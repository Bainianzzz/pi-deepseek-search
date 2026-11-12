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
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const API_BASE_URL = "https://api.deepseek.com/v1/tools";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

interface Config {
	apiKey: string;
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	summary: string;
	content: string;
	site_name: string | null;
	site_icon: string | null;
	date: string | null;
	authority: number;
	rerank_score: number;
}

interface StoredResult {
	title: string;
	url: string;
	siteName: string | null;
	date: string | null;
	authority: number;
	score: number;
	summaryChars: number;
	contentChars: number;
}

interface SearchDetails {
	kind: "search";
	query: string;
	results: StoredResult[];
	error?: string;
}

interface FetchDetails {
	kind: "fetch";
	url: string;
	title: string;
	contentChars: number;
	truncated: boolean;
	error?: string;
}

type Details = SearchDetails | FetchDetails;

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function readProviderConfig(): { apiKey?: string } {
	for (const dir of [agentDir(), join(process.cwd(), ".pi")]) {
		let raw: string;
		try {
			raw = readFileSync(join(dir, "models.json"), "utf8");
		} catch {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		const providers = (parsed as { providers?: Record<string, unknown> }).providers;
		if (!providers || typeof providers !== "object") continue;

		for (const [id, value] of Object.entries(providers)) {
			const provider = value as { baseUrl?: unknown; apiKey?: unknown };
			const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl : "";
			let host = "";
			try {
				host = new URL(baseUrl).host;
			} catch {
				host = "";
			}
			const looksDeepSeek = host.endsWith("deepseek.com") || /deepseek/i.test(id);
			if (!looksDeepSeek) continue;

			const apiKey = typeof provider.apiKey === "string" ? provider.apiKey : undefined;
			return { apiKey };
		}
	}
	return {};
}

/** Resolved on every call so env / models.json changes apply without a reload. */
function resolveConfig(): Config {
	const fromModels = readProviderConfig();

	let apiKey = "";
	for (const name of ["DEEPSEEK_SEARCH_API_KEY", "DEEPSEEK_API_KEY"]) {
		const value = process.env[name]?.trim();
		if (!value) continue;
		apiKey = value;
		break;
	}
	if (!apiKey && fromModels.apiKey) apiKey = fromModels.apiKey;
	if (!apiKey) {
		throw new Error(
			"Missing DeepSeek API key. Set DEEPSEEK_SEARCH_API_KEY (or DEEPSEEK_API_KEY), or add a DeepSeek provider with apiKey to ~/.pi/agent/models.json.",
		);
	}

	return { apiKey };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error("Aborted"));
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(new Error("Aborted"));
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function describeHttpError(status: number, body: string): string {
	let detail = "";
	try {
		const parsed = JSON.parse(body) as { error?: { message?: unknown; code?: unknown } };
		if (typeof parsed.error?.message === "string") detail = parsed.error.message;
	} catch {
		detail = body.slice(0, 300);
	}
	const meaning: Record<number, string> = {
		400: "invalid request",
		401: "missing or invalid API key",
		402: "insufficient account balance",
		403: "fetch rejected by security policy",
		404: "no usable page content could be retrieved",
		408: "request timeout",
		413: "request body too large",
		429: "rate limit exceeded",
		500: "server error",
		504: "upstream timeout",
	};
	const reason = meaning[status] ?? "request failed";
	return `DeepSeek API HTTP ${status} (${reason})${detail ? `: ${detail}` : ""}`;
}

async function callApi<T>(
	endpoint: "search" | "fetch",
	body: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<T> {
	const { apiKey } = resolveConfig();
	const url = `${API_BASE_URL}/${endpoint}`;
	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (signal?.aborted) throw new Error("Aborted");
		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw new Error("Aborted");
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt === maxAttempts) throw lastError;
			await sleep(500 * 2 ** (attempt - 1), signal);
			continue;
		}

		const text = await response.text();
		if (response.ok) return JSON.parse(text) as T;

		if (RETRYABLE.has(response.status) && attempt < maxAttempts) {
			await sleep(500 * 2 ** (attempt - 1), signal);
			continue;
		}
		throw new Error(describeHttpError(response.status, text));
	}

	throw lastError instanceof Error ? lastError : new Error("DeepSeek request failed");
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
	if (text.length <= max) return { text, truncated: false };
	return {
		text: `${text.slice(0, max)}\n\n… [truncated, ${text.length - max} more characters]`,
		truncated: true,
	};
}

function formatDate(date: string | null): string | undefined {
	if (!date) return undefined;
	const parsed = new Date(date);
	if (Number.isNaN(parsed.getTime())) return undefined;
	return parsed.toISOString().slice(0, 10);
}

const SUMMARY_LIMIT = 1200;
const CONTENT_LIMIT_PER_RESULT = 8000;
const CONTENT_LIMIT_TOTAL = 60000;

function formatSearchResult(
	query: string,
	results: SearchResult[],
	contentBudget: { left: number },
): string {
	const lines: string[] = [];
	lines.push(`Search results for "${query}" (${results.length}):`);
	results.forEach((result, index) => {
		const meta = [
			result.site_name,
			formatDate(result.date),
			`score ${result.rerank_score?.toFixed?.(2) ?? result.rerank_score}`,
			result.authority >= 0 ? `authority ${result.authority}` : undefined,
		]
			.filter(Boolean)
			.join(" · ");

		lines.push("");
		lines.push(`${index + 1}. ${result.title || "(untitled)"}`);
		lines.push(`   ${result.url}`);
		if (meta) lines.push(`   ${meta}`);

		const summary = truncate(result.summary || result.snippet || "", SUMMARY_LIMIT);
		if (summary.text) lines.push(`   ${summary.text.replace(/\n/g, "\n   ")}`);

		if (result.content) {
			if (contentBudget.left <= 0) {
				lines.push("   [content omitted: total content budget reached — use fetch on the URL]");
			} else {
				const budget = Math.min(CONTENT_LIMIT_PER_RESULT, contentBudget.left);
				const content = truncate(result.content, budget);
				contentBudget.left -= Math.min(result.content.length, budget);
				lines.push("   --- content ---");
				lines.push(`   ${content.text.replace(/\n/g, "\n   ")}`);
			}
		}
	});
	return lines.join("\n");
}

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

		async execute(_toolCallId, params, signal): Promise<{ content: { type: "text"; text: string }[]; details: Details; isError?: boolean }> {
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

				const text = formatSearchResult(query, results, { left: CONTENT_LIMIT_TOTAL });
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
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			let line = theme.fg("toolTitle", theme.bold("search "));
			line += theme.fg("accent", `"${args.query ?? ""}"`);
			if (args.count) line += theme.fg("dim", ` count=${args.count}`);
			if (args.needContent) line += theme.fg("dim", " +content");
			text.setText(line);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as SearchDetails | undefined;
			if (details?.error) {
				text.setText(theme.fg("error", `✗ ${details.error}`));
				return text;
			}
			const count = details?.results.length ?? 0;
			let line = theme.fg(count > 0 ? "success" : "muted", `${count} result${count === 1 ? "" : "s"}`);
			const shown = expanded ? details?.results ?? [] : (details?.results ?? []).slice(0, 3);
			for (const item of shown) {
				const meta = [item.siteName, formatDate(item.date)].filter(Boolean).join(" · ");
				line += `\n  ${theme.fg("accent", item.title || "(untitled)")}`;
				line += `\n  ${theme.fg("dim", item.url)}${meta ? theme.fg("muted", `  ${meta}`) : ""}`;
			}
			if (!expanded && count > shown.length) {
				line += `\n  ${theme.fg("dim", `… ${count - shown.length} more`)}`;
			}
			text.setText(line);
			return text;
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
			maxChars: Type.Optional(
				Type.Integer({
					minimum: 1000,
					maximum: 200000,
					description: "Maximum characters of Markdown content returned (default 40000)",
				}),
			),
		}),

		async execute(_toolCallId, params, signal): Promise<{ content: { type: "text"; text: string }[]; details: Details; isError?: boolean }> {
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
					details: { kind: "fetch", url, title: "", contentChars: 0, truncated: false, error: "invalid url" },
					isError: true,
				};
			}

			try {
				const data = await callApi<{ title?: string; content?: string }>("fetch", { url }, signal);
				const title = data.title ?? "";
				const content = data.content ?? "";
				const cap = params.maxChars ?? 40000;
				const clipped = truncate(content, cap);

				const header = [`# ${title || url}`, `Source: ${url}`, ""].join("\n");
				return {
					content: [{ type: "text", text: header + clipped.text }],
					details: {
						kind: "fetch",
						url,
						title,
						contentChars: content.length,
						truncated: clipped.truncated,
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
						truncated: false,
						error: message,
					},
					isError: true,
				};
			}
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", args.url ?? ""));
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as FetchDetails | undefined;
			if (details?.error) {
				text.setText(theme.fg("error", `✗ ${details.error}`));
				return text;
			}
			let line = theme.fg("success", `✓ ${details?.title || details?.url || "fetched"}`);
			line += theme.fg("dim", `  ${details?.contentChars ?? 0} chars`);
			if (details?.truncated) line += theme.fg("warning", " (truncated)");
			if (expanded) line += `\n${theme.fg("dim", details?.url ?? "")}`;
			text.setText(line);
			return text;
		},
	});
}
