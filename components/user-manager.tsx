"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type UserItem = {
  id: string;
  username: string;
  role: string;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string | null;
};

export function UserManager({ users }: { users: UserItem[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function toggleStatus(user: UserItem) {
    setError("");
    const response = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: user.status === "active" ? "disabled" : "active",
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
      {error ? <div className="error-text">{error}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>角色</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>最后登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.role}</td>
                <td>
                  <span className={`pill ${user.status === "active" ? "success" : "danger"}`}>
                    {user.status === "active" ? "启用" : "停用"}
                  </span>
                </td>
                <td>{new Date(user.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-"}</td>
                <td>
                  <button className="btn-secondary" type="button" disabled={isPending} onClick={() => startTransition(() => toggleStatus(user))}>
                    {user.status === "active" ? "停用账号" : "恢复账号"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
