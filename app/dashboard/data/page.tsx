import Link from "next/link";

import { listRecords } from "@/lib/services/records";
import { requireUser } from "@/lib/services/auth";
import { listSources } from "@/lib/services/sources";

export default async function DataPage() {
  const user = await requireUser();
  const sources = await listSources(user);
  const records = await listRecords({
    sourceIds: sources.map((item) => item.id),
    limit: 200,
  });

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h2>数据结果</h2>
          <p>所有数据源最终都会被归一化到同一个 records 集合，再从这里看和导出。</p>
        </div>
        <div className="btn-row">
          <Link className="btn-secondary" href="/api/records/export?mode=legacy">
            导出现有四类汇总
          </Link>
          <Link className="btn" href="/api/records/export?mode=flat">
            导出当前结果
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>类型</th>
                <th>标题</th>
                <th>链接</th>
                <th>发布时间</th>
                <th>指标</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={String(record._id)}>
                  <td>{record.kind}</td>
                  <td>{record.title}</td>
                  <td>
                    <a href={record.url} target="_blank" rel="noreferrer">
                      {record.url}
                    </a>
                  </td>
                  <td>{record.publishedAt ? new Date(record.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-"}</td>
                  <td className="mono">{JSON.stringify(record.metrics)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
