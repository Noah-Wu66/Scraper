import { upsertRecord } from "@/lib/services/records";
import { buildDedupeKey, extractEmbeddedState, parseIsoDate } from "@/lib/source-runners/helpers";
import type { RunDocument, SourceDocument } from "@/lib/types";

interface YangshipinVideoItem {
  title: string;
  vid: string;
  h5Link?: string;
  like_cnt?: number;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
  });
  if (!response.ok) {
    throw new Error(`抓取页面失败: ${url}`);
  }
  return response.text();
}

export async function runYangshipinVideos(source: SourceDocument, run: RunDocument) {
  const config = source.config as Record<string, any>;
  const cpid = String(config.cpid || "");
  const itemLimit = Number(config.itemLimit || 20);
  const userHtml = await fetchText(`https://w.yangshipin.cn/user?cpid=${cpid}`);
  const state = extractEmbeddedState(userHtml, "user");
  const items = (state.payloads?.userShareData?.video_list || []).slice(0, itemLimit) as YangshipinVideoItem[];

  for (const item of items) {
    const detailUrl = item.h5Link || `https://m.yangshipin.cn/portrait_video?vid=${item.vid}`;
    const detailHtml = await fetchText(detailUrl);
    const detailState = extractEmbeddedState(detailHtml, "portrait_video");
    const videoData = detailState.payloads?.videoDataList?.items?.[0]?.videoData || {};

    await upsertRecord({
      sourceId: source._id!,
      runId: run._id!,
      kind: "yangshipin_video",
      title: String(videoData.title || item.title || ""),
      url: String(videoData.shareItem?.shareUrl || detailUrl),
      publishedAt: parseIsoDate(String(videoData.subTitle || "").replace(/\//g, "-")),
      dedupeKey: buildDedupeKey([source._id, item.vid]),
      metrics: {
        playCount: videoData.playCount ? Number(videoData.playCount) : null,
        likeCount: Number(videoData.likeCount ?? videoData.likeItem?.likeNum ?? item.like_cnt ?? 0),
      },
      payload: {
        videoId: item.vid,
        shareItem: videoData.shareItem || {},
        brief: videoData.portraitBriefInfo || "",
        follow: videoData.detailFollowItem || {},
      },
    });
  }

  return {
    requestPayload: { cpid, itemLimit },
    responsePayload: {
      total: items.length,
    },
    stats: {
      total: items.length,
    },
  };
}
