import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "懂车顾问 · 选车决策 Agent",
  description: "基于 LangGraph + RAG 的选车决策 Agent（作品集 Demo）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
