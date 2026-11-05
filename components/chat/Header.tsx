"use client";

import type { Health } from "./types";

interface Props {
  health: Health | null;
  traceId: string;
  onHistory: () => void;
  onNewSession: () => void;
  onTrace: () => void;
}

export default function Header({ health, traceId, onHistory, onNewSession, onTrace }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <div className="logo">懂</div>
        <div>
          <h1>懂车顾问 · 选车决策 Agent</h1>
          <p>LangGraph 编排 · RAG 口碑检索 · 人工确认预约</p>
        </div>
      </div>
      <div className="badges">
        <span className={`badge ${health?.llm.enabled ? "live" : "mock"}`}>
          {health?.llm.enabled ? `LLM 在线 · ${health.llm.model}` : "Mock 模式（未配 Key）"}
        </span>
        {health && (
          <>
            <span className="badge" title={health.postgres.error ?? ""}>
              {health.postgres.connected ? "PG 已连接" : health.postgres.configured ? "PG 连接失败" : "内存数据"}
            </span>
            <span className="badge" title={health.redis.error ?? ""}>
              {health.redis.connected ? "Redis 已连接" : health.redis.configured ? "Redis 连接失败" : "内存缓存"}
            </span>
            {health.langfuse?.configured && <span className="badge">Langfuse</span>}
          </>
        )}
        <button className="badge trace-btn" onClick={onHistory}>
          历史会话
        </button>
        <button className="badge trace-btn" onClick={onNewSession}>
          新对话
        </button>
        {traceId && (
          <button className="badge trace-btn" onClick={onTrace}>
            查看 Trace
          </button>
        )}
      </div>
    </header>
  );
}
