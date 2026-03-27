import type { SourceDocument } from "@/lib/types";

export const SYSTEM_SOURCE_DEFAULTS: Array<Pick<SourceDocument, "kind" | "name" | "scope" | "enabled" | "config">> = [
  {
    kind: "weibo_posts",
    name: "央视军事微博",
    scope: "system",
    enabled: true,
    config: {
      uid: "6189120710",
      collectWindowDays: 7,
      device: "mobile",
      outputFormats: ["markdown", "json", "links"],
    },
  },
  {
    kind: "weibo_topics",
    name: "央视军事微博话题",
    scope: "system",
    enabled: true,
    config: {
      hostName: "央视军事",
      topicLimit: 12,
      overviewRange: "30d",
    },
  },
  {
    kind: "yangshipin_videos",
    name: "央视军事央视频",
    scope: "system",
    enabled: true,
    config: {
      cpid: "18141106690386005",
      itemLimit: 20,
    },
  },
  {
    kind: "wechat_csv",
    name: "微信 CSV 导入",
    scope: "system",
    enabled: true,
    config: {},
  },
];
