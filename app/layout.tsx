import "./globals.css";

import type { ReactNode } from "react";

import { ensureBootstrap } from "@/lib/bootstrap";

export const metadata = {
  title: "CPEC 数据平台",
  description: "XCrawl + 现有脚本迁移后的正式数据平台",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureBootstrap();

  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
