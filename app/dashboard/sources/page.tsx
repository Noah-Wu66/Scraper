import { SourceManager } from "@/components/source-manager";
import { requireUser } from "@/lib/services/auth";
import { listSources } from "@/lib/services/sources";

export default async function SourcesPage() {
  const user = await requireUser();
  const sources = await listSources(user);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h2>数据源管理</h2>
          <p>这里是平台真正的入口：专用源、XCrawl 通用源、定时计划都从这里出发。</p>
        </div>
      </header>
      <SourceManager sources={JSON.parse(JSON.stringify(sources))} canAdmin={user.role === "admin"} />
    </div>
  );
}
