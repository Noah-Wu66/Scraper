import { requireUser } from "@/lib/services/auth";
import { listRuns } from "@/lib/services/runs";

export default async function RunsPage() {
  const user = await requireUser();
  const runs = await listRuns(user);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h2>任务记录</h2>
          <p>所有手动执行、定时触发、Webhook 回调最终都会落到这里。</p>
        </div>
      </header>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>来源</th>
                <th>类型</th>
                <th>状态</th>
                <th>触发方式</th>
                <th>外部任务 ID</th>
                <th>创建时间</th>
                <th>完成时间</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.sourceName}</td>
                  <td>{run.sourceKind}</td>
                  <td>
                    <span className={`pill ${run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "warning"}`}>
                      {run.status}
                    </span>
                  </td>
                  <td>{run.trigger}</td>
                  <td className="mono">{run.externalTaskId || "-"}</td>
                  <td>{new Date(run.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</td>
                  <td>{run.completedAt ? new Date(run.completedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-"}</td>
                  <td>
                    {run.errorMessage ? (
                      <span className="error-text">{run.errorMessage}</span>
                    ) : run.stats ? (
                      <span className="help">{JSON.stringify(run.stats)}</span>
                    ) : (
                      <span className="help">-</span>
                    )}
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
