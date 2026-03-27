import { URLSearchParams } from "node:url";

import { xcrawlScrape } from "@/lib/services/xcrawl";
import { upsertRecord } from "@/lib/services/records";
import { buildDedupeKey, findSystemSourceId, listRecordsByKind, normalizeScrapeJson } from "@/lib/source-runners/helpers";
import type { RunDocument, SourceDocument } from "@/lib/types";

function buildTopicUrl(topic: string) {
  const params = new URLSearchParams({
    showmenu: "0",
    topnavstyle: "1",
    immersiveScroll: "60",
    q: `#${topic}#`,
  });
  return `https://m.s.weibo.com/vtopic/detail_new?${params.toString()}`;
}

function buildTopicPrompt(topic: string) {
  return [
    `从微博话题详情页提取话题 ${topic} 的核心数据。`,
    "只返回 JSON，不要解释。",
    "字段必须是：topicName、hostName、readCount、discussionCount、hotRankPeak。",
    "hotRankPeak 只要最高热搜名次，没有就返回 null。",
  ].join("");
}

export async function runWeiboTopics(source: SourceDocument, run: RunDocument) {
  const config = source.config as Record<string, any>;
  const hostName = String(config.hostName || "");
  const topicLimit = Number(config.topicLimit || 12);
  const postsSourceId = await findSystemSourceId("weibo_posts");
  const postRecords = await listRecordsByKind("weibo_post", postsSourceId || undefined);

  const topics = new Map<string, string | null>();
  for (const record of postRecords) {
    const payloadTopics = Array.isArray(record.payload?.topics) ? record.payload.topics : [];
    for (const item of payloadTopics) {
      const topic = String(item || "").trim();
      if (!topic || topics.has(topic)) {
        continue;
      }
      topics.set(topic, record.publishedAt ? record.publishedAt.toISOString() : null);
      if (topics.size >= topicLimit) {
        break;
      }
    }
    if (topics.size >= topicLimit) {
      break;
    }
  }

  let total = 0;
  const details: Array<Record<string, unknown>> = [];
  for (const [topic, sourcePublishedAt] of topics.entries()) {
    const requestPayload = {
      url: buildTopicUrl(topic),
      mode: "sync",
      request: {
        device: "mobile",
        locale: "zh-CN,zh;q=0.9",
      },
      js_render: {
        enabled: true,
        wait_until: "networkidle",
      },
      output: {
        formats: ["json", "markdown"],
        json: {
          prompt: buildTopicPrompt(topic),
        },
      },
    };

    const response = await xcrawlScrape(requestPayload);
    const json = normalizeScrapeJson(response?.data?.json);
    if (!json) {
      continue;
    }
    if (hostName && String(json.hostName || "").trim() !== hostName) {
      continue;
    }

    total += 1;
    details.push({ topic, response });
    await upsertRecord({
      sourceId: source._id!,
      runId: run._id!,
      kind: "weibo_topic",
      title: String(json.topicName || topic),
      url: buildTopicUrl(topic),
      dedupeKey: buildDedupeKey([source._id, json.topicName || topic]),
      metrics: {
        readCount: json.readCount === null ? null : Number(json.readCount ?? 0),
        discussionCount: json.discussionCount === null ? null : Number(json.discussionCount ?? 0),
      },
      payload: {
        topicName: String(json.topicName || topic),
        hostName: String(json.hostName || ""),
        hotRankPeak: json.hotRankPeak === null ? null : Number(json.hotRankPeak ?? 0),
        sourcePublishedAt,
      },
    });
  }

  return {
    requestPayload: {
      hostName,
      topicLimit,
      topics: Array.from(topics.keys()),
    },
    responsePayload: {
      total,
      details,
    },
    stats: {
      total,
    },
  };
}
