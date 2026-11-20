/**
 * Shared types for the DeepSeek Search / Fetch extension.
 *
 * This module has no local imports and only type-level exports, so it can be
 * imported from anywhere without creating an import cycle.
 */

import type { Component } from "@earendil-works/pi-tui";

export interface Config {
	apiKey: string;
}

export interface SearchResult {
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

export interface StoredResult {
	title: string;
	url: string;
	siteName: string | null;
	date: string | null;
	authority: number;
	score: number;
	summaryChars: number;
	contentChars: number;
}

export interface SearchDetails {
	kind: "search";
	query: string;
	results: StoredResult[];
	error?: string;
}

export interface FetchDetails {
	kind: "fetch";
	url: string;
	title: string;
	contentChars: number;
	error?: string;
}

export type Details = SearchDetails | FetchDetails;

/** Shape returned by both tool `execute` implementations. */
export interface ToolResult {
	content: { type: "text"; text: string }[];
	details: Details;
	isError?: boolean;
}

/** Only the piece of the tool render context the renderers rely on. */
export interface RenderContext {
	lastComponent?: Component;
}
