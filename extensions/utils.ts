/**
 * API plumbing and text formatting for the DeepSeek Search tool.
 * TUI renderers live in ./render.ts.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config, SearchResult } from "./types.ts";

export const API_BASE_URL = "https://api.deepseek.com/v1/tools";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

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

export async function callApi<T>(
	endpoint: "search",
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

export function formatDate(date: string | null): string | undefined {
	if (!date) return undefined;
	const parsed = new Date(date);
	if (Number.isNaN(parsed.getTime())) return undefined;
	return parsed.toISOString().slice(0, 10);
}

export function formatSearchResult(query: string, results: SearchResult[]): string {
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

		const summary = result.summary || result.snippet || "";
		if (summary) lines.push(`   ${summary.replace(/\n/g, "\n   ")}`);

		if (result.content) {
			lines.push("   --- content ---");
			lines.push(`   ${result.content.replace(/\n/g, "\n   ")}`);
		}
	});
	return lines.join("\n");
}
