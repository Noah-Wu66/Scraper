import { getEnvStatus } from "@/lib/env";
import { requireAdmin, requireUser } from "@/lib/services/auth";

export default async function SettingsPage() {
  const user = await requireUser();
  requireAdmin(user);
  const status = getEnvStatus();

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h2>系统设置</h2>
          <p>这里不展示真正密钥，只给你看部署时有没有把关键环境变量配上。</p>
        </div>
      </header>

      <section className="grid-3">
        {Object.entries(status).map(([key, value]) => (
          <article className="panel stat-card" key={key}>
            <h3>{key}</h3>
            <div className="value">{value ? "已配置" : "缺失"}</div>
            <div className="meta">缺失时 `/api/ready` 会直接报未就绪</div>
          </article>
        ))}
      </section>
    </div>
  );
}
