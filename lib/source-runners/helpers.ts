import { ObjectId } from "mongodb";

import { recordsCollection, sourcesCollection } from "@/lib/db/collections";
import { upsertRecord } from "@/lib/services/records";
import { safeJsonParse, sha256 } from "@/lib/utils";
import type { RecordKind, RunDocument, SourceDocument } from "@/lib/types";

export function buildDedupeKey(parts: Array<string | number | null | undefined>) {
  return sha256(
    parts
      .filter((item) => item !== null && item !== undefined && item !== "")
      .map((item) => String(item))
      .join("::"),
  );
}

export function extractEmbeddedState(html: string, key: string) {
  const match = html.match(new RegExp(`window\\.__STATE_${key}__=(\\{.*?\\})<\\/script>`, "s"));
  if (!match) {
    throw new Error(`未找到页面状态: ${key}`);
  }

  return JSON.parse(match[1]) as Record<string, any>;
}

export function normalizeUrlArray(payload: any) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.data?.urls)) {
    return payload.data.urls;
  }
  if (Array.isArray(payload?.data?.results)) {
    return payload.data.results;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }
  return [];
}

export function normalizeScrapeJson(raw: any) {
  if (!raw) {
    return null;
  }
  if (typeof raw === "string") {
    return safeJsonParse(raw, null);
  }
  return raw;
}

export async function findSystemSourceId(kind: SourceDocument["kind"]) {
  const sources = await sourcesCollection();
  const source = await sources.findOne({ kind, scope: "system" });
  return source?._id ? String(source._id) : null;
}

export async function listRecordsByKind(kind: RecordKind, sourceId?: string) {
  const records = await recordsCollection();
  const query: Record<string, unknown> = { kind };
  if (sourceId) {
    query.sourceId = new ObjectId(sourceId);
  }
  return records.find(query, { sort: { publishedAt: -1 } }).toArray();
}

export async function storeNormalizedRecord(input: Parameters<typeof upsertRecord>[0]) {
  await upsertRecord(input);
  return input;
}

export function parseIsoDate(value: unknown) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getRunId(run: RunDocument) {
  if (!run._id) {
    throw new Error("任务 ID 不存在");
  }
  return String(run._id);
}
