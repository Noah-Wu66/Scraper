import { UserManager } from "@/components/user-manager";
import { listUsers, requireAdmin, requireUser } from "@/lib/services/auth";

export default async function UsersPage() {
  const user = await requireUser();
  requireAdmin(user);
  const users = await listUsers(user);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h2>用户管理</h2>
          <p>公开注册已经打开，所以这里主要用来停用异常账号和查看登录情况。</p>
        </div>
      </header>
      <section className="panel">
        <UserManager users={JSON.parse(JSON.stringify(users))} />
      </section>
    </div>
  );
}
