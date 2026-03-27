import Link from "next/link";

import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <main className="center-shell">
      <section className="auth-card">
        <h1>登录数据平台</h1>
        <p>账号密码登录后，就能进入正式后台，管理任务、导入 CSV、查看采集结果。</p>
        <AuthForm mode="login" />
        <p className="help">
          还没有账号？<Link href="/register">去注册</Link>
        </p>
      </section>
    </main>
  );
}
