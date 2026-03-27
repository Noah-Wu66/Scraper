import * as XLSX from "xlsx";

import type { RecordDocument } from "@/lib/types";

function formatDate(value?: Date | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(value);
}

function metricValue(record: RecordDocument, key: string) {
  return record.metrics[key] ?? 0;
}

export function buildLegacyWorkbook(records: RecordDocument[]) {
  const workbook = XLSX.utils.book_new();
  const grouped = {
    wechat: records.filter((item) => item.kind === "wechat_article"),
    weibo: records.filter((item) => item.kind === "weibo_post"),
    topic: records.filter((item) => item.kind === "weibo_topic"),
    cctv: records.filter((item) => item.kind === "yangshipin_video"),
  };

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      grouped.wechat.map((item, index) => ({
        序号: index + 1,
        标题: item.title,
        链接: item.url,
        发布时间: formatDate(item.publishedAt),
        阅读量: metricValue(item, "readCount"),
        点赞量: metricValue(item, "likeCount"),
        在看量: metricValue(item, "watchCount"),
      })),
    ),
    "微信",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      grouped.weibo.map((item, index) => ({
        序号: index + 1,
        标题: item.title,
        链接: item.url,
        发布时间: formatDate(item.publishedAt),
        转发量: metricValue(item, "forwardCount"),
        点赞量: metricValue(item, "likeCount"),
        评论量: metricValue(item, "commentCount"),
        视频播放量: metricValue(item, "playCount"),
      })),
    ),
    "微博",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      grouped.topic.map((item, index) => ({
        序号: index + 1,
        话题名称: item.payload.topicName ?? item.title,
        话题主持人: item.payload.hostName ?? "",
        话题阅读量: metricValue(item, "readCount"),
        话题讨论量: metricValue(item, "discussionCount"),
      })),
    ),
    "微博话题",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      grouped.topic
        .filter((item) => Number(item.payload.hotRankPeak ?? 0) > 0)
        .map((item, index) => ({
          序号: index + 1,
          热搜标题: item.payload.topicName ?? item.title,
          最高排名: item.payload.hotRankPeak ?? "",
          话题主持人: item.payload.hostName ?? "",
          话题阅读量: metricValue(item, "readCount"),
        })),
    ),
    "热搜",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      grouped.cctv.map((item, index) => ({
        序号: index + 1,
        标题: item.title,
        链接: item.url,
        发布时间: formatDate(item.publishedAt),
        播放量: metricValue(item, "playCount"),
        点赞量: metricValue(item, "likeCount"),
      })),
    ),
    "央视频",
  );

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function buildFlatWorkbook(records: RecordDocument[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      records.map((item) => ({
        类型: item.kind,
        标题: item.title,
        链接: item.url,
        发布时间: formatDate(item.publishedAt),
        指标: JSON.stringify(item.metrics),
      })),
    ),
    "数据",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
