import { ObjectId } from "mongodb";

import { schedulesCollection, sourcesCollection } from "@/lib/db/collections";
import { ensureBootstrap } from "@/lib/bootstrap";
import { computeNextRunAt } from "@/lib/time";
import type { AuthUser, ScheduleDocument, SourceDocument, SourceKind } from "@/lib/types";

export interface ScheduleInput {
  enabled: boolean;
  type: "daily" | "weekly";
  hour: number;
  minute: number;
  weekday?: number | null;
  timezone?: string;
}

export interface CreateSourceInput {
  kind: SourceKind;
  name: string;
  config: Record<string, unknown>;
  schedule?: ScheduleInput | null;
}

export interface UpdateSourceInput {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  schedule?: ScheduleInput | null;
}

export async function listSources(user: AuthUser) {
  await ensureBootstrap();
  const sources = await sourcesCollection();
  const schedules = await schedulesCollection();

  const docs = await sources
    .find(
      user.role === "admin"
        ? {}
        : {
            $or: [
              { scope: "system" },
              { ownerId: new ObjectId(user.id) },
            ],
          },
    )
    .sort({ scope: 1, createdAt: 1 })
    .toArray();

  const sourceIds = docs.map((item) => item._id).filter(Boolean) as ObjectId[];
  const scheduleDocs = await schedules.find({ sourceId: { $in: sourceIds } }).toArray();

  return docs.map((item) => ({
    id: String(item._id),
    kind: item.kind,
    name: item.name,
    scope: item.scope,
    enabled: item.enabled,
    config: item.config,
    lastRunAt: item.lastRunAt ?? null,
    schedule: scheduleDocs.find((schedule) => String(schedule.sourceId) === String(item._id)) ?? null,
  }));
}

export async function getSourceForUser(user: AuthUser, sourceId: string) {
  await ensureBootstrap();
  const sources = await sourcesCollection();
  const source = await sources.findOne({ _id: new ObjectId(sourceId) });
  if (!source) {
    throw new Error("数据源不存在");
  }

  if (source.scope === "private" && String(source.ownerId) !== user.id && user.role !== "admin") {
    throw new Error("没有权限访问这个数据源");
  }

  return source;
}

export async function createSource(user: AuthUser, input: CreateSourceInput) {
  await ensureBootstrap();
  if (!["xcrawl_search", "xcrawl_scrape", "xcrawl_map", "xcrawl_crawl"].includes(input.kind)) {
    throw new Error("这里只能新建通用 XCrawl 数据源");
  }
  const name = input.name.trim();
  if (!name) {
    throw new Error("数据源名称不能为空");
  }
  const now = new Date();
  const sources = await sourcesCollection();
  const result = await sources.insertOne({
    kind: input.kind,
    name,
    scope: "private",
    ownerId: new ObjectId(user.id),
    enabled: true,
    config: input.config,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await upsertSchedule(result.insertedId, input.schedule ?? null);
  return getSourceForUser(user, String(result.insertedId));
}

export async function updateSource(user: AuthUser, sourceId: string, input: UpdateSourceInput) {
  const source = await getSourceForUser(user, sourceId);
  if (source.scope === "system" && user.role !== "admin") {
    throw new Error("只有管理员能修改系统数据源");
  }

  const patch: Partial<SourceDocument> = {
    updatedAt: new Date(),
  };
  if (typeof input.name === "string") {
    const name = input.name.trim();
    if (!name) {
      throw new Error("数据源名称不能为空");
    }
    patch.name = name;
  }
  if (typeof input.enabled === "boolean") {
    patch.enabled = input.enabled;
  }
  if (input.config) {
    patch.config = input.config;
  }

  const sources = await sourcesCollection();
  await sources.updateOne({ _id: source._id }, { $set: patch });
  await upsertSchedule(source._id!, input.schedule ?? null);
  return getSourceForUser(user, sourceId);
}

export async function deleteSource(user: AuthUser, sourceId: string) {
  const source = await getSourceForUser(user, sourceId);
  if (source.scope === "system") {
    throw new Error("系统数据源不能删除");
  }

  const [sources, schedules] = await Promise.all([sourcesCollection(), schedulesCollection()]);
  await Promise.all([
    sources.deleteOne({ _id: source._id }),
    schedules.deleteMany({ sourceId: source._id! }),
  ]);
}

export async function upsertSchedule(sourceId: ObjectId, schedule: ScheduleInput | null) {
  const schedules = await schedulesCollection();
  if (!schedule || !schedule.enabled) {
    await schedules.deleteMany({ sourceId });
    return null;
  }

  const nextRunAt = computeNextRunAt({
    type: schedule.type,
    hour: schedule.hour,
    minute: schedule.minute,
    weekday: schedule.weekday ?? null,
  });

  const now = new Date();
  const patch: Partial<ScheduleDocument> = {
    enabled: true,
    type: schedule.type,
    timezone: schedule.timezone ?? "Asia/Shanghai",
    hour: schedule.hour,
    minute: schedule.minute,
    weekday: schedule.weekday ?? null,
    nextRunAt,
    updatedAt: now,
  };

  await schedules.updateOne(
    { sourceId },
    {
      $set: patch,
      $setOnInsert: {
        sourceId,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  return nextRunAt;
}
