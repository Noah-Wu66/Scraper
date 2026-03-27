import { recordsCollection, runsCollection, schedulesCollection, sourcesCollection } from "@/lib/db/collections";

export default async function DashboardPage() {
  const [sources, schedules, runs, records] = await Promise.all([
    sourcesCollection(),
    schedulesCollection(),
    runsCollection(),
    recordsCollection(),
  ]);

  const [sourceCount, activeSourceCount, scheduleCount, runCount, recordCount, recentRuns] = await Promise.all([
    sources.countDocuments(),
    sources.countDocuments({ enabled: true }),
    schedules.countDocuments({ enabled: true }),
    runs.countDocuments(),
    records.countDocuments(),
    runs.find({}, { sort: { createdAt: -1 }, limit: 8 }).toArray(),
  ]);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h2>平台总览</h2>
          <p>这里看整个平台的运行状态、任务流转和数据累计。</p>
        </div>
      </header>

      <section className="grid-4">
        <article className="panel stat-card">
          <h3>数据源总数</h3>
          <div className="value">{sourceCount}</div>
          <div className="meta">其中启用中 {activeSourceCount} 个</div>
        </article>
        <article className="panel stat-card">
          <h3>定时计划</h3>
          <div className="value">{scheduleCount}</div>
          <div className="meta">Cron 每分钟进来一次，由数据库决定谁该跑</div>
        </article>
        <article className="panel stat-card">
          <h3>累计任务</h3>
          <div className="value">{runCount}</div>
          <div className="meta">包含手动任务、定时任务和异步回调</div>
        </article>
        <article className="panel stat-card">
          <h3>累计记录</h3>
          <div className="value">{recordCount}</div>
          <div className="meta">所有源归一化后的数据都在这里</div>
        </article>
      </section>

      <section className="panel">
        <h3>最近任务</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>类型</th>
                <th>状态</th>
                <th>触发方式</th>
                <th>创建时间</th>
                <th>完成时间</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={String(run._id)}>
                  <td>{run.sourceKind}</td>
                  <td>
                    <span className={`pill ${run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "warning"}`}>
                      {run.status}
                    </span>
                  </td>
                  <td>{run.trigger}</td>
                  <td>{new Date(run.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</td>
                  <td>{run.completedAt ? new Date(run.completedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
