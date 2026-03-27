import { getEnv } from "@/lib/env";
import { xcrawlCrawl, xcrawlMap, xcrawlScrape, xcrawlSearch } from "@/lib/services/xcrawl";
import { upsertRecord } from "@/lib/services/records";
import { buildDedupeKey, normalizeScrapeJson, normalizeUrlArray, parseIsoDate } from "@/lib/source-runners/helpers";
import type { RunDocument, SourceDocument } from "@/lib/types";

export async function runXcrawlSearch(source: SourceDocument, run: RunDocument) {
  const config = source.config as Record<string, any>;
  const payload = {
    query: config.query,
    location: config.location || "CN",
    language: config.language || "zh",
    limit: Number(config.limit || 10),
  };
  const response = await xcrawlSearch(payload);
  const items = normalizeUrlArray(response);

  for (const item of items) {
    const url = typeof item === "string" ? item : String(item.url || item.link || "");
    if (!url) {
      continue;
    }
    await upsertRecord({
      sourceId: source._id!,
      runId: run._id!,
      kind: "xcrawl_search_result",
      title: typeof item === "string" ? item : String(item.title || item.name || url),
      url,
      publishedAt: null,
      dedupeKey: buildDedupeKey([source._id, url]),
      metrics: {
        rank: typeof item === "object" && item.position ? Number(item.position) : null,
      },
      payload: typeof item === "object" ? item : { url: item },
    });
  }

  return {
    requestPayload: payload,
    responsePayload: response,
    stats: {
      total: items.length,
    },
  };
}

export async function runXcrawlMap(source: SourceDocument, run: RunDocument) {
  const config = source.config as Record<string, any>;
  const payload = {
    url: config.url,
    filter: config.filter || undefined,
    limit: Number(config.limit || 500),
    include_subdomains: Boolean(config.includeSubdomains),
    ignore_query_parameters: config.ignoreQueryParameters !== false,
  };
  const response = await xcrawlMap(payload);
  const items = normalizeUrlArray(response);

  for (const item of items) {
    const url = typeof item === "string" ? item : String(item.url || "");
    if (!url) {
      continue;
    }
    await upsertRecord({
      sourceId: source._id!,
      runId: run._id!,
      kind: "xcrawl_map_result",
      title: url,
      url,
      publishedAt: null,
      dedupeKey: buildDedupeKey([source._id, url]),
      payload: typeof item === "object" ? item : { url },
    });
  }

  return {
    requestPayload: payload,
    responsePayload: response,
    stats: { total: items.length },
  };
}

export async function enqueueXcrawlScrape(source: SourceDocument) {
  const config = source.config as Record<string, any>;
  const env = getEnv();
  const payload = {
    url: config.url,
    mode: "async",
    proxy: config.proxyLocation
      ? {
          location: config.proxyLocation,
          sticky_session: config.stickySession || undefined,
        }
      : undefined,
    request: {
      device: config.device || "desktop",
      locale: config.locale || "zh-CN,zh;q=0.9",
      cookies: config.cookiesJson || undefined,
      headers: config.headersJson || undefined,
    },
    js_render: {
      enabled: true,
      wait_until: config.waitUntil || "networkidle",
    },
    output: {
      formats: Array.isArray(config.formats) && config.formats.length > 0 ? config.formats : ["markdown"],
      json: config.jsonPrompt || config.jsonSchema
        ? {
            prompt: config.jsonPrompt || undefined,
            json_schema: config.jsonSchema || undefined,
          }
        : undefined,
    },
    webhook: {
      url: `${env.APP_BASE_URL}/api/webhooks/xcrawl`,
      headers: {
        "X-Webhook-Secret": env.XCRAWL_WEBHOOK_SECRET,
      },
      events: ["started", "completed", "failed"],
    },
  };
  const response = await xcrawlScrape(payload);
  return {
    requestPayload: payload,
    responsePayload: response,
    externalTaskId: response.scrape_id as string,
  };
}

export async function enqueueXcrawlCrawl(source: SourceDocument) {
  const config = source.config as Record<string, any>;
  const env = getEnv();
  const payload = {
    url: config.url,
    crawler: {
      limit: Number(config.limit || 100),
      include: Array.isArray(config.include) ? config.include : [],
      exclude: Array.isArray(config.exclude) ? config.exclude : [],
      max_depth: Number(config.maxDepth || 3),
      include_entire_domain: Boolean(config.includeEntireDomain),
      include_subdomains: Boolean(config.includeSubdomains),
      include_external_links: Boolean(config.includeExternalLinks),
    },
    proxy: config.proxyLocation
      ? {
          location: config.proxyLocation,
          sticky_session: config.stickySession || undefined,
        }
      : undefined,
    request: {
      device: config.device || "desktop",
      locale: config.locale || "zh-CN,zh;q=0.9",
      cookies: config.cookiesJson || undefined,
      headers: config.headersJson || undefined,
    },
    js_render: {
      enabled: true,
      wait_until: config.waitUntil || "networkidle",
    },
    output: {
      formats: Array.isArray(config.formats) && config.formats.length > 0 ? config.formats : ["markdown"],
      json: config.jsonPrompt || config.jsonSchema
        ? {
            prompt: config.jsonPrompt || undefined,
            json_schema: config.jsonSchema || undefined,
          }
        : undefined,
    },
    webhook: {
      url: `${env.APP_BASE_URL}/api/webhooks/xcrawl`,
      headers: {
        "X-Webhook-Secret": env.XCRAWL_WEBHOOK_SECRET,
      },
      events: ["started", "completed", "failed"],
    },
  };
  const response = await xcrawlCrawl(payload);
  return {
    requestPayload: payload,
    responsePayload: response,
    externalTaskId: response.crawl_id as string,
  };
}

export async function processXcrawlScrapeResult(source: SourceDocument, run: RunDocument, payload: any) {
  const data = payload.data || {};
  const json = normalizeScrapeJson(data.json);
  const title = String(
    json?.title ||
      json?.name ||
      data?.metadata?.title ||
      payload.url ||
      source.name,
  );
  const publishedAt = parseIsoDate(json?.publishedAt || json?.publishDate || data?.metadata?.published_at);

  await upsertRecord({
    sourceId: source._id!,
    runId: run._id!,
    kind: "xcrawl_scrape_result",
    title,
    url: String(payload.url || source.config.url || ""),
    publishedAt,
    dedupeKey: buildDedupeKey([source._id, payload.url || source.config.url]),
    payload: {
      metadata: data.metadata || {},
      markdown: data.markdown || "",
      summary: data.summary || "",
      json,
      links: data.links || [],
    },
  });

  return {
    total: 1,
  };
}

export async function processXcrawlCrawlResult(source: SourceDocument, run: RunDocument, payload: any) {
  const pages = Array.isArray(payload?.data?.pages)
    ? payload.data.pages
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  let total = 0;
  for (const page of pages) {
    const url = String(page.url || page.page_url || "");
    if (!url) {
      continue;
    }
    total += 1;
    const json = normalizeScrapeJson(page.json);
    await upsertRecord({
      sourceId: source._id!,
      runId: run._id!,
      kind: "xcrawl_crawl_result",
      title: String(json?.title || page.metadata?.title || url),
      url,
      publishedAt: parseIsoDate(json?.publishedAt || page.metadata?.published_at),
      dedupeKey: buildDedupeKey([source._id, url]),
      payload: {
        metadata: page.metadata || {},
        markdown: page.markdown || "",
        summary: page.summary || "",
        json,
        links: page.links || [],
      },
    });
  }

  return {
    total,
  };
}
