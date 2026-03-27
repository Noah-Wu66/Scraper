import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { requireUser } from "@/lib/services/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "总览" },
  { href: "/dashboard/sources", label: "数据源" },
  { href: "/dashboard/runs", label: "任务记录" },
  { href: "/dashboard/data", label: "数据结果" },
  { href: "/dashboard/imports/wechat", label: "微信导入" },
  { href: "/dashboard/users", label: "用户管理" },
  { href: "/dashboard/settings", label: "系统设置" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="dashboard-shell shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>CPEC 数据平台</h1>
          <p>{user.username} · {user.role === "admin" ? "管理员" : "普通用户"}</p>
        </div>
        <nav className="nav-links">
          {NAV_ITEMS.filter((item) => user.role === "admin" || !["/dashboard/users", "/dashboard/settings"].includes(item.href)).map((item) => (
            <Link className="nav-link" key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 18 }}>
          <LogoutButton />
        </div>
      </aside>
      <main className="content-area">{children}</main>
    </div>
  );
}
