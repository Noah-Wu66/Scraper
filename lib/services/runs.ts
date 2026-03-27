import { ObjectId } from "mongodb";

import { ensureBootstrap } from "@/lib/bootstrap";
import {
  runArtifactsCollection,
  runsCollection,
  schedulesCollection,
  sourcesCollection,
} from "@/lib/db/collections";
import { computeNextRunAt } from "@/lib/time";
import type { AuthUser, RunDocument, RunTrigger, SourceDocument } from "@/lib/types";
import { executeSource } from "@/lib/source-runners";
import {
  processXcrawlCrawlResult,
  processXcrawlScrapeResult,
} from "@/lib/source-runners/xcrawl";

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && Number((error as { code?: number }).code) === 11000
  );
}

export async function createRun(source: SourceDocument, trigger: RunTrigger, requestedBy?: string | null, idempotencyKey?: string | null) {
  const runs = await runsCollection();
  const now = new Date();
  const result = await runs.insertOne({
    sourceId: source._id!,
    sourceKind: source.kind,
    trigger,
    status: "running",
    requestedBy: requestedBy ? new ObjectId(requestedBy) : null,
    errorMessage: null,
    stats: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  const run = await runs.findOne({ _id: result.insertedId });
  if (!run) {
    throw new Error("创建任务失败");
  }

  return run;
}

export async function addRunArtifact(input: {
  runId: string | ObjectId;
  sourceId: string | ObjectId;
  artifactType: "request" | "response" | "webhook" | "upload";
  payload: Record<string, unknown>;
}) {
  const artifacts = await runArtifactsCollection();
  await artifacts.insertOne({
    runId: typeof input.runId === "string" ? new ObjectId(input.runId) : input.runId,
    sourceId: typeof input.sourceId === "string" ? new ObjectId(input.sourceId) : input.sourceId,
    artifactType: input.artifactType,
    payload: input.payload,
    createdAt: new Date(),
  });
}

export async function markRunCompleted(runId: string | ObjectId, stats?: Record<string, unknown> | null) {
  const runs = await runsCollection();
  await runs.updateOne(
    { _id: typeof runId === "string" ? new ObjectId(runId) : runId },
    {
      $set: {
        status: "completed",
        stats: stats ?? null,
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    },
  );
}

export async function markRunFailed(runId: string | ObjectId, errorMessage: string) {
  const runs = await runsCollection();
  await runs.updateOne(
    { _id: typeof runId === "string" ? new ObjectId(runId) : runId },
    {
      $set: {
        status: "failed",
        errorMessage,
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    },
  );
}

export async function listRuns(user: AuthUser) {
  await ensureBootstrap();
  const sources = await sourcesCollection();
  const ownedSourceIds = await sources
    .find(
      user.role === "admin"
        ? {}
        : {
            $or: [{ scope: "system" }, { ownerId: new ObjectId(user.id) }],
          },
    )
    .map((item) => item._id)
    .toArray();

  const runs = await runsCollection();
  const docs = await runs
    .find({ sourceId: { $in: ownedSourceIds } }, { sort: { createdAt: -1 }, limit: 200 })
    .toArray();

  const sourceMap = new Map(
    (await sources.find({ _id: { $in: ownedSourceIds } }).toArray()).map((item) => [String(item._id), item]),
  );

  return docs.map((item) => ({
    id: String(item._id),
    status: item.status,
    trigger: item.trigger,
    sourceKind: item.sourceKind,
    sourceName: sourceMap.get(String(item.sourceId))?.name || String(item.sourceId),
    externalTaskId: item.externalTaskId ?? null,
    createdAt: item.createdAt,
    completedAt: item.completedAt ?? null,
    stats: item.stats ?? null,
    errorMessage: item.errorMessage ?? null,
  }));
}

export async function getRunById(user: AuthUser, runId: string) {
  await ensureBootstrap();
  const runs = await runsCollection();
  const run = await runs.findOne({ _id: new ObjectId(runId) });
  if (!run) {
    throw new Error("任务不存在");
  }

  const sources = await sourcesCollection();
  const source = await sources.findOne({ _id: run.sourceId });
  if (!source) {
    throw new Error("数据源不存在");
  }

  if (source.scope === "private" && String(source.ownerId) !== user.id && user.role !== "admin") {
    throw new Error("没有权限查看这个任务");
  }

  const artifacts = await runArtifactsCollection();
  const items = await artifacts.find({ runId: run._id! }, { sort: { createdAt: 1 } }).toArray();

  return {
    run,
    source,
    artifacts: items,
  };
}

export async function triggerSourceRun(source: SourceDocument, trigger: RunTrigger, user?: AuthUser | null, idempotencyKey?: string | null) {
  let run: RunDocument;
  try {
    run = await createRun(source, trigger, user?.id ?? null, idempotencyKey);
  } catch (error) {
    if (!idempotencyKey || !isDuplicateKeyError(error)) {
      throw error;
    }

    const runs = await runsCollection();
    const existing = await runs.findOne({ idempotencyKey });
    if (!existing) {
      throw error;
    }

    return {
      runId: String(existing._id),
      status: existing.status,
      externalTaskId: existing.externalTaskId ?? null,
      stats: existing.stats ?? null,
    };
  }

  try {
    const result = await executeSource(source, run);

    if (result.requestPayload) {
      await addRunArtifact({
        runId: run._id!,
        sourceId: source._id!,
        artifactType: "request",
        payload: result.requestPayload,
      });
    }

    if (result.responsePayload) {
      await addRunArtifact({
        runId: run._id!,
        sourceId: source._id!,
        artifactType: "response",
        payload: result.responsePayload,
      });
    }

    if (result.externalTaskId) {
      const runs = await runsCollection();
      await runs.updateOne(
        { _id: run._id! },
        { $set: { externalTaskId: result.externalTaskId, updatedAt: new Date() } },
      );
      return { runId: String(run._id), status: "running", externalTaskId: result.externalTaskId };
    }

    await markRunCompleted(run._id!, result.stats ?? null);
    await updateSourceRunTimestamps(source._id!);
    return { runId: String(run._id), status: "completed", stats: result.stats ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务执行失败";
    await markRunFailed(run._id!, message);
    throw error;
  }
}

async function updateSourceRunTimestamps(sourceId: ObjectId) {
  const sources = await sourcesCollection();
  await sources.updateOne(
    { _id: sourceId },
    { $set: { lastRunAt: new Date(), updatedAt: new Date() } },
  );
}

export async function processXcrawlWebhook(payload: Record<string, any>) {
  await ensureBootstrap();
  const externalTaskId = String(payload.scrape_id || payload.crawl_id || "");
  if (!externalTaskId) {
    throw new Error("Webhook 缺少任务 ID");
  }

  const runs = await runsCollection();
  const run = await runs.findOne({ externalTaskId });
  if (!run) {
    throw new Error("找不到对应的任务");
  }

  const sources = await sourcesCollection();
  const source = await sources.findOne({ _id: run.sourceId });
  if (!source) {
    throw new Error("找不到对应的数据源");
  }

  await addRunArtifact({
    runId: run._id!,
    sourceId: source._id!,
    artifactType: "webhook",
    payload,
  });

  const status = String(payload.status || "");
  if (status === "failed") {
    await markRunFailed(run._id!, String(payload.error || "XCrawl 任务失败"));
    return run;
  }

  if (status !== "completed") {
    return run;
  }

  let stats: Record<string, unknown> | null = null;
  if (run.sourceKind === "xcrawl_scrape") {
    stats = await processXcrawlScrapeResult(source, run, payload);
  } else if (run.sourceKind === "xcrawl_crawl") {
    stats = await processXcrawlCrawlResult(source, run, payload);
  }

  await markRunCompleted(run._id!, stats);
  await updateSourceRunTimestamps(source._id!);
  return run;
}

export async function runDueSchedules() {
  await ensureBootstrap();

  const schedules = await schedulesCollection();
  const sources = await sourcesCollection();
  const now = new Date();
  const triggered: string[] = [];

  while (true) {
    const schedule = await schedules.findOneAndUpdate(
      {
        enabled: true,
        nextRunAt: { $lte: now },
        $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
      },
      {
        $set: {
          lockUntil: new Date(now.getTime() + 60 * 1000),
          updatedAt: now,
        },
      },
      {
        sort: { nextRunAt: 1 },
        returnDocument: "after",
      },
    );

    if (!schedule) {
      break;
    }

    try {
      const source = await sources.findOne({ _id: schedule.sourceId, enabled: true });
      if (source) {
        const minuteToken = `${schedule._id}:${now.toISOString().slice(0, 16)}`;
        await triggerSourceRun(source, "schedule", null, minuteToken);
        triggered.push(String(source._id));
      }
    } finally {
      const nextRunAt = computeNextRunAt({
        type: schedule.type,
        hour: schedule.hour,
        minute: schedule.minute,
        weekday: schedule.weekday ?? null,
        from: now,
      });
      await schedules.updateOne(
        { _id: schedule._id! },
        {
          $set: {
            nextRunAt,
            lastRunAt: now,
            lockUntil: null,
            updatedAt: new Date(),
          },
        },
      );
    }
  }

  return {
    triggeredCount: triggered.length,
    triggeredSourceIds: triggered,
  };
}
