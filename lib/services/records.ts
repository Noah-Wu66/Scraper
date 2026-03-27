import { ObjectId } from "mongodb";

import { recordsCollection } from "@/lib/db/collections";
import type { RecordDocument, RecordKind } from "@/lib/types";

export async function upsertRecord(input: {
  sourceId: string | ObjectId;
  runId: string | ObjectId;
  kind: RecordKind;
  title: string;
  url: string;
  publishedAt?: Date | null;
  dedupeKey: string;
  metrics?: Record<string, number | null>;
  payload?: Record<string, unknown>;
}) {
  const records = await recordsCollection();
  const now = new Date();
  const sourceObjectId = typeof input.sourceId === "string" ? new ObjectId(input.sourceId) : input.sourceId;
  const runObjectId = typeof input.runId === "string" ? new ObjectId(input.runId) : input.runId;

  const patch: Partial<RecordDocument> = {
    runId: runObjectId,
    kind: input.kind,
    title: input.title,
    url: input.url,
    publishedAt: input.publishedAt ?? null,
    metrics: input.metrics ?? {},
    payload: input.payload ?? {},
    lastSeenAt: now,
    updatedAt: now,
  };

  await records.updateOne(
    { sourceId: sourceObjectId, dedupeKey: input.dedupeKey },
    {
      $set: patch,
      $setOnInsert: {
        sourceId: sourceObjectId,
        dedupeKey: input.dedupeKey,
        firstSeenAt: now,
        createdAt: now,
      },
    },
    { upsert: true },
  );
}

export async function listRecords(filter: {
  sourceIds?: string[];
  kinds?: string[];
  q?: string;
  limit?: number;
}) {
  const records = await recordsCollection();
  const query: Record<string, unknown> = {};

  if (filter.sourceIds) {
    query.sourceId = { $in: filter.sourceIds.map((item) => new ObjectId(item)) };
  }

  if (filter.kinds && filter.kinds.length > 0) {
    query.kind = { $in: filter.kinds };
  }

  if (filter.q) {
    query.$or = [
      { title: { $regex: filter.q, $options: "i" } },
      { url: { $regex: filter.q, $options: "i" } },
    ];
  }

  return records
    .find(query, { sort: { publishedAt: -1, updatedAt: -1 }, limit: filter.limit ?? 200 })
    .toArray();
}
