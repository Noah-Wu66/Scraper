import { ObjectId } from "mongodb";

import { ensureBootstrap } from "@/lib/bootstrap";
import { fail, ok } from "@/lib/http";
import { parseWechatCsv } from "@/lib/services/wechat-csv";
import { requireUser } from "@/lib/services/auth";
import { addRunArtifact, createRun, markRunCompleted, markRunFailed } from "@/lib/services/runs";
import { upsertRecord } from "@/lib/services/records";
import { sourcesCollection } from "@/lib/db/collections";

export async function POST(request: Request) {
  let runId: ObjectId | null = null;
  try {
    await ensureBootstrap();
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("请上传 CSV 文件");
    }

    const text = await file.text();
    const rows = parseWechatCsv(text);
    const sources = await sourcesCollection();
    const source = await sources.findOne({ kind: "wechat_csv", scope: "system" });
    if (!source) {
      throw new Error("未找到微信数据源");
    }

    const run = await createRun(source, "manual", user.id);
    runId = run._id ?? null;
    await addRunArtifact({
      runId: run._id!,
      sourceId: source._id!,
      artifactType: "upload",
      payload: {
        fileName: file.name,
        size: file.size,
      },
    });

    for (const row of rows) {
      await upsertRecord({
        sourceId: source._id!,
        runId: run._id!,
        kind: "wechat_article",
        title: row.title,
        url: row.url,
        publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
        dedupeKey: `${source._id}:${row.url}`,
        metrics: {
          readCount: row.readCount,
          likeCount: row.likeCount,
          watchCount: row.watchCount,
        },
        payload: {},
      });
    }

    await sources.updateOne(
      { _id: new ObjectId(String(source._id)) },
      { $set: { lastRunAt: new Date(), updatedAt: new Date() } },
    );
    await markRunCompleted(run._id!, { total: rows.length });
    return ok({ total: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入失败";
    if (runId) {
      await markRunFailed(runId, message);
    }
    return fail(message, 400);
  }
}
