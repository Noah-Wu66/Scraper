import { xcrawlScrape } from "@/lib/services/xcrawl";
import { upsertRecord } from "@/lib/services/records";
import { buildDedupeKey, normalizeScrapeJson, parseIsoDate } from "@/lib/source-runners/helpers";
import type { RunDocument, SourceDocument } from "@/lib/types";

function buildPrompt(uid: string) {
  return [
    `从微博用户页中提取这个账号当前页面可见的最新微博列表，账号 UID 为 ${uid}。`,
    "只返回 JSON，不要解释。",
    "字段必须是 posts 数组。",
    "每条 posts 里返回：title、url、publishedAt、forwardCount、likeCount、commentCount、playCount、topics。",
    "topics 必须是字符串数组，只保留 #话题# 的正文，不要带 #。",
    "如果数字看不清，返回 null。",
  ].join("");
}

export async function runWeiboPosts(source: SourceDocument, run: RunDocument) {
  const config = source.config as Record<string, any>;
  const uid = String(config.uid || "");
  const url = `https://m.weibo.cn/u/${uid}`;
  const requestPayload = {
    url,
    mode: "sync",
    request: {
      device: config.device || "mobile",
      locale: "zh-CN,zh;q=0.9",
      cookies: config.cookiesJson || undefined,
      headers: config.headersJson || undefined,
    },
    js_render: {
      enabled: true,
      wait_until: "networkidle",
    },
    output: {
      formats: ["json", "links", "markdown"],
      json: {
        prompt: buildPrompt(uid),
      },
    },
  };

  const response = await xcrawlScrape(requestPayload);
  const json = normalizeScrapeJson(response?.data?.json);
  const posts = Array.isArray(json?.posts) ? json.posts : [];

  for (const item of posts) {
    const postUrl = String(item.url || "");
    if (!postUrl) {
      continue;
    }
    await upsertRecord({
      sourceId: source._id!,
      runId: run._id!,
      kind: "weibo_post",
      title: String(item.title || ""),
      url: postUrl,
      publishedAt: parseIsoDate(item.publishedAt),
      dedupeKey: buildDedupeKey([source._id, postUrl]),
      metrics: {
        forwardCount: item.forwardCount === null ? null : Number(item.forwardCount ?? 0),
        likeCount: item.likeCount === null ? null : Number(item.likeCount ?? 0),
        commentCount: item.commentCount === null ? null : Number(item.commentCount ?? 0),
        playCount: item.playCount === null ? null : Number(item.playCount ?? 0),
      },
      payload: {
        topics: Array.isArray(item.topics) ? item.topics : [],
      },
    });
  }

  return {
    requestPayload,
    responsePayload: response,
    stats: {
      total: posts.length,
    },
  };
}
