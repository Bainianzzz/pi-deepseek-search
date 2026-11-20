/**
 * TUI renderers for the search / fetch tools.
 *
 * `renderCall` / `renderResult` are re-run on every redraw (streaming, expand /
 * collapse), so each renderer mutates the component from `context.lastComponent`
 * in place instead of building a new one — see Pi's extension docs.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { FetchDetails, RenderContext, SearchDetails } from "./types.ts";
import { formatDate } from "./utils.ts";

function reuseText(context: RenderContext | undefined): Text {
	return (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
}

export function renderSearchCall(
	args: { query?: string; count?: number; needContent?: boolean },
	theme: Theme,
	context?: RenderContext,
): Text {
	const text = reuseText(context);
	let line = theme.fg("toolTitle", theme.bold("search "));
	line += theme.fg("accent", `"${args.query ?? ""}"`);
	if (args.count) line += theme.fg("dim", ` count=${args.count}`);
	if (args.needContent) line += theme.fg("dim", " +content");
	text.setText(line);
	return text;
}

export function renderSearchResult(
	details: SearchDetails | undefined,
	expanded: boolean,
	theme: Theme,
	context?: RenderContext,
): Text {
	const text = reuseText(context);
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
}

export function renderFetchCall(args: { url?: string }, theme: Theme, context?: RenderContext): Text {
	const text = reuseText(context);
	text.setText(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", args.url ?? ""));
	return text;
}

export function renderFetchResult(
	details: FetchDetails | undefined,
	expanded: boolean,
	theme: Theme,
	context?: RenderContext,
): Text {
	const text = reuseText(context);
	if (details?.error) {
		text.setText(theme.fg("error", `✗ ${details.error}`));
		return text;
	}
	let line = theme.fg("success", `✓ ${details?.title || details?.url || "fetched"}`);
	line += theme.fg("dim", `  ${details?.contentChars ?? 0} chars`);
	if (expanded) line += `\n${theme.fg("dim", details?.url ?? "")}`;
	text.setText(line);
	return text;
}
