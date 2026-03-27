"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

type SourceItem = {
  id: string;
  kind: string;
  name: string;
  scope: "system" | "private";
  enabled: boolean;
  config: Record<string, unknown>;
  lastRunAt?: string | null;
  schedule?: {
    type: "daily" | "weekly";
    hour: number;
    minute: number;
    weekday?: number | null;
  } | null;
};

function prettyDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function buildConfig(kind: string, form: Record<string, string>) {
  switch (kind) {
    case "xcrawl_search":
      return {
        query: form.query,
        location: form.location || "CN",
        language: form.language || "zh",
        limit: Number(form.limit || 10),
      };
    case "xcrawl_map":
      return {
        url: form.url,
        filter: form.filter,
        limit: Number(form.limit || 500),
        includeSubdomains: form.includeSubdomains === "on",
        ignoreQueryParameters: form.ignoreQueryParameters !== "off",
      };
    case "xcrawl_scrape":
      return {
        url: form.url,
        device: form.device || "desktop",
        waitUntil: form.waitUntil || "networkidle",
        formats: form.formats
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        jsonPrompt: form.jsonPrompt,
        proxyLocation: form.proxyLocation,
        stickySession: form.stickySession,
      };
    case "xcrawl_crawl":
      return {
        url: form.url,
        limit: Number(form.limit || 100),
        maxDepth: Number(form.maxDepth || 3),
        include: form.include
          .split(/\r?\n|,/)
          .map((item) => item.trim())
          .filter(Boolean),
        exclude: form.exclude
          .split(/\r?\n|,/)
          .map((item) => item.trim())
          .filter(Boolean),
        device: form.device || "desktop",
        waitUntil: form.waitUntil || "networkidle",
        formats: form.formats
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        jsonPrompt: form.jsonPrompt,
        proxyLocation: form.proxyLocation,
        stickySession: form.stickySession,
      };
    default:
      return {};
  }
}

export function SourceManager({ sources, canAdmin }: { sources: SourceItem[]; canAdmin: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [kind, setKind] = useState("xcrawl_search");
  const [form, setForm] = useState<Record<string, string>>({
    name: "",
    query: "",
    url: "",
    location: "CN",
    language: "zh",
    limit: "10",
    filter: "",
    includeSubdomains: "on",
    ignoreQueryParameters: "on",
    device: "desktop",
    waitUntil: "networkidle",
    formats: "markdown,json",
    jsonPrompt: "",
    maxDepth: "3",
    include: "",
    exclude: "",
    proxyLocation: "",
    stickySession: "",
    scheduleEnabled: "",
    scheduleType: "daily",
    scheduleHour: "9",
    scheduleMinute: "0",
    scheduleWeekday: "1",
  });

  const currentHints = useMemo(() => {
    if (kind === "xcrawl_search") {
      return "用关键词发现内容，适合找线索和发现目标 URL。";
    }
    if (kind === "xcrawl_map") {
      return "扫站内 URL 清单，适合先摸清一个站点有哪些链接。";
    }
    if (kind === "xcrawl_scrape") {
      return "抓单页正文和结构化数据，适合文章页、详情页。";
    }
    return "按规则批量抓页面，适合文档站、资讯站、目录站。";
  }, [kind]);

  async function createSource() {
    setError("");
    const schedule =
      form.scheduleEnabled === "on"
        ? {
            enabled: true,
            type: form.scheduleType as "daily" | "weekly",
            hour: Number(form.scheduleHour || 9),
            minute: Number(form.scheduleMinute || 0),
            weekday: form.scheduleType === "weekly" ? Number(form.scheduleWeekday || 1) : null,
          }
        : null;

    const response = await fetch("/api/sources", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind,
        name: form.name || kind,
        config: buildConfig(kind, form),
        schedule,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setError(payload?.error?.message || "创建失败");
      return;
    }
    router.refresh();
  }

  async function runSource(sourceId: string) {
    setError("");
    const response = await fetch(`/api/sources/${sourceId}/run`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setError(payload?.error?.message || "执行失败");
      return;
    }
    router.refresh();
  }

  async function deleteSource(source: SourceItem) {
    if (source.scope === "system") {
      return;
    }
    setError("");
    const response = await fetch(`/api/sources/${source.id}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setError(payload?.error?.message || "删除失败");
      return;
    }
    router.refresh();
  }

  async function toggleSource(source: SourceItem) {
    setError("");
    const response = await fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: !source.enabled,
        schedule: source.schedule
          ? {
              enabled: true,
              type: source.schedule.type,
              hour: source.schedule.hour,
              minute: source.schedule.minute,
              weekday: source.schedule.weekday ?? null,
            }
          : null,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setError(payload?.error?.message || "更新失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="stack">
      <div className="two-panel">
        <section className="panel">
          <h3>新增通用 XCrawl 数据源</h3>
          <p className="help">{currentHints}</p>
          <div className="stack">
            <div className="field">
              <label>类型</label>
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="xcrawl_search">XCrawl Search</option>
                <option value="xcrawl_scrape">XCrawl Scrape</option>
                <option value="xcrawl_map">XCrawl Map</option>
                <option value="xcrawl_crawl">XCrawl Crawl</option>
              </select>
            </div>
            <div className="field">
              <label>名称</label>
              <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            </div>
            {kind === "xcrawl_search" ? (
              <>
                <div className="field">
                  <label>关键词</label>
                  <input value={form.query} onChange={(event) => setForm((prev) => ({ ...prev, query: event.target.value }))} />
                </div>
                <div className="grid-3">
                  <div className="field">
                    <label>地区</label>
                    <input value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))} />
                  </div>
                  <div className="field">
                    <label>语言</label>
                    <input value={form.language} onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))} />
                  </div>
                  <div className="field">
                    <label>数量上限</label>
                    <input value={form.limit} onChange={(event) => setForm((prev) => ({ ...prev, limit: event.target.value }))} />
                  </div>
                </div>
              </>
            ) : null}
            {kind !== "xcrawl_search" ? (
              <div className="field">
                <label>URL</label>
                <input value={form.url} onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))} />
              </div>
            ) : null}
            {kind === "xcrawl_map" ? (
              <div className="grid-2">
                <div className="field">
                  <label>过滤正则</label>
                  <input value={form.filter} onChange={(event) => setForm((prev) => ({ ...prev, filter: event.target.value }))} />
                </div>
                <div className="field">
                  <label>数量上限</label>
                  <input value={form.limit} onChange={(event) => setForm((prev) => ({ ...prev, limit: event.target.value }))} />
                </div>
              </div>
            ) : null}
            {kind === "xcrawl_scrape" || kind === "xcrawl_crawl" ? (
              <>
                <div className="grid-3">
                  <div className="field">
                    <label>设备</label>
                    <select value={form.device} onChange={(event) => setForm((prev) => ({ ...prev, device: event.target.value }))}>
                      <option value="desktop">desktop</option>
                      <option value="mobile">mobile</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>等待策略</label>
                    <select value={form.waitUntil} onChange={(event) => setForm((prev) => ({ ...prev, waitUntil: event.target.value }))}>
                      <option value="load">load</option>
                      <option value="domcontentloaded">domcontentloaded</option>
                      <option value="networkidle">networkidle</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>输出格式</label>
                    <input value={form.formats} onChange={(event) => setForm((prev) => ({ ...prev, formats: event.target.value }))} />
                  </div>
                </div>
                <div className="field">
                  <label>JSON 提取提示词</label>
                  <textarea value={form.jsonPrompt} onChange={(event) => setForm((prev) => ({ ...prev, jsonPrompt: event.target.value }))} />
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>代理地区</label>
                    <input value={form.proxyLocation} onChange={(event) => setForm((prev) => ({ ...prev, proxyLocation: event.target.value }))} placeholder="比如 SG / JP / US" />
                  </div>
                  <div className="field">
                    <label>Sticky Session</label>
                    <input value={form.stickySession} onChange={(event) => setForm((prev) => ({ ...prev, stickySession: event.target.value }))} />
                  </div>
                </div>
              </>
            ) : null}
            {kind === "xcrawl_crawl" ? (
              <>
                <div className="grid-2">
                  <div className="field">
                    <label>抓取页数上限</label>
                    <input value={form.limit} onChange={(event) => setForm((prev) => ({ ...prev, limit: event.target.value }))} />
                  </div>
                  <div className="field">
                    <label>最大深度</label>
                    <input value={form.maxDepth} onChange={(event) => setForm((prev) => ({ ...prev, maxDepth: event.target.value }))} />
                  </div>
                </div>
                <div className="field">
                  <label>只包含这些正则</label>
                  <textarea value={form.include} onChange={(event) => setForm((prev) => ({ ...prev, include: event.target.value }))} />
                </div>
                <div className="field">
                  <label>排除这些正则</label>
                  <textarea value={form.exclude} onChange={(event) => setForm((prev) => ({ ...prev, exclude: event.target.value }))} />
                </div>
              </>
            ) : null}
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={form.scheduleEnabled === "on"}
                  onChange={(event) => setForm((prev) => ({ ...prev, scheduleEnabled: event.target.checked ? "on" : "" }))}
                />{" "}
                打开定时任务
              </label>
            </div>
            {form.scheduleEnabled === "on" ? (
              <div className="grid-4">
                <div className="field">
                  <label>类型</label>
                  <select value={form.scheduleType} onChange={(event) => setForm((prev) => ({ ...prev, scheduleType: event.target.value }))}>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                  </select>
                </div>
                <div className="field">
                  <label>小时</label>
                  <input value={form.scheduleHour} onChange={(event) => setForm((prev) => ({ ...prev, scheduleHour: event.target.value }))} />
                </div>
                <div className="field">
                  <label>分钟</label>
                  <input value={form.scheduleMinute} onChange={(event) => setForm((prev) => ({ ...prev, scheduleMinute: event.target.value }))} />
                </div>
                {form.scheduleType === "weekly" ? (
                  <div className="field">
                    <label>星期</label>
                    <select value={form.scheduleWeekday} onChange={(event) => setForm((prev) => ({ ...prev, scheduleWeekday: event.target.value }))}>
                      <option value="1">周一</option>
                      <option value="2">周二</option>
                      <option value="3">周三</option>
                      <option value="4">周四</option>
                      <option value="5">周五</option>
                      <option value="6">周六</option>
                      <option value="0">周日</option>
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}
            {error ? <div className="error-text">{error}</div> : null}
            <div className="btn-row">
              <button className="btn" type="button" disabled={isPending} onClick={() => startTransition(createSource)}>
                {isPending ? "保存中..." : "创建数据源"}
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <h3>现有系统源说明</h3>
          <div className="stack">
            <div className="details-box">
              系统内已经预置了微博、微博话题、央视频、微信 CSV 四类源。微博相关因为公开页会触发访客拦截，所以走专用 XCrawl 提取器；央视频会直接抓公开页状态；微信继续上传 CSV。
            </div>
            <div className="details-box">
              私有源默认只属于你自己；系统源对所有登录用户可见，但只有管理员能停用系统源。
            </div>
            <div className="details-box">
              当前页面已经能手动运行、创建通用源、停用私有源；如果你要大改某个通用源的配置，删掉重建会更快。
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <h3>数据源列表</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>范围</th>
                <th>状态</th>
                <th>计划</th>
                <th>上次执行</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <strong>{source.name}</strong>
                    <div className="help">{source.kind}</div>
                  </td>
                  <td>{source.kind}</td>
                  <td>{source.scope === "system" ? "系统" : "私有"}</td>
                  <td>
                    <span className={`pill ${source.enabled ? "success" : "danger"}`}>
                      {source.enabled ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="help">
                    {source.schedule
                      ? `${source.schedule.type === "daily" ? "每天" : "每周"} ${String(source.schedule.hour).padStart(2, "0")}:${String(source.schedule.minute).padStart(2, "0")}`
                      : "未设置"}
                  </td>
                  <td>{prettyDate(source.lastRunAt)}</td>
                  <td>
                    <div className="inline-actions">
                      <button className="btn-secondary" type="button" onClick={() => startTransition(() => runSource(source.id))}>
                        立即跑
                      </button>
                      {(source.scope === "private" || canAdmin) ? (
                        <button className="btn-secondary" type="button" onClick={() => startTransition(() => toggleSource(source))}>
                          {source.enabled ? "停用" : "启用"}
                        </button>
                      ) : null}
                      {source.scope === "private" ? (
                        <button className="btn-danger" type="button" onClick={() => startTransition(() => deleteSource(source))}>
                          删除
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
