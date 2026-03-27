import { getEnv } from "@/lib/env";

const XCRAWL_BASE_URL = "https://run.xcrawl.com/v1";

async function xcrawlFetch<T>(path: string, payload?: Record<string, unknown>, method = "POST") {
  const env = getEnv();
  const response = await fetch(`${XCRAWL_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.XCRAWL_API_KEY}`,
    },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || `XCrawl 请求失败: ${response.status}`);
  }

  return data as T;
}

export async function xcrawlSearch(payload: Record<string, unknown>) {
  return xcrawlFetch("/search", payload);
}

export async function xcrawlMap(payload: Record<string, unknown>) {
  return xcrawlFetch("/map", payload);
}

export async function xcrawlScrape(payload: Record<string, unknown>) {
  return xcrawlFetch("/scrape", payload);
}

export async function xcrawlScrapeResult(scrapeId: string) {
  return xcrawlFetch(`/scrape/${scrapeId}`, undefined, "GET");
}

export async function xcrawlCrawl(payload: Record<string, unknown>) {
  return xcrawlFetch("/crawl", payload);
}

export async function xcrawlCrawlResult(crawlId: string) {
  return xcrawlFetch(`/crawl/${crawlId}`, undefined, "GET");
}
