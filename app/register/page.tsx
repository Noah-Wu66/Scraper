import Link from "next/link";

import { AuthForm } from "@/components/auth-form";

export default function RegisterPage() {
  return (
    <main className="center-shell">
      <section className="auth-card">
        <h1>注册并进入后台</h1>
        <p>按你定下来的规则，这个系统支持公开注册，注册完立刻可以用。</p>
        <AuthForm mode="register" />
        <p className="help">
          已有账号？<Link href="/login">去登录</Link>
        </p>
      </section>
    </main>
  );
}
