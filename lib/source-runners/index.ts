import { runWeiboPosts } from "@/lib/source-runners/weibo-posts";
import { runWeiboTopics } from "@/lib/source-runners/weibo-topics";
import {
  enqueueXcrawlCrawl,
  enqueueXcrawlScrape,
  runXcrawlMap,
  runXcrawlSearch,
} from "@/lib/source-runners/xcrawl";
import { runYangshipinVideos } from "@/lib/source-runners/yangshipin";
import type { RunDocument, SourceDocument } from "@/lib/types";

export async function executeSource(source: SourceDocument, run: RunDocument) {
  switch (source.kind) {
    case "xcrawl_search":
      return runXcrawlSearch(source, run);
    case "xcrawl_map":
      return runXcrawlMap(source, run);
    case "xcrawl_scrape":
      return enqueueXcrawlScrape(source);
    case "xcrawl_crawl":
      return enqueueXcrawlCrawl(source);
    case "yangshipin_videos":
      return runYangshipinVideos(source, run);
    case "weibo_posts":
      return runWeiboPosts(source, run);
    case "weibo_topics":
      return runWeiboTopics(source, run);
    case "wechat_csv":
      throw new Error("微信源请走 CSV 导入，不支持直接运行");
    default:
      throw new Error("暂不支持这个数据源类型");
  }
}
