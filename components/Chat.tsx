"use client";

import { useEffect, useRef, useState } from "react";
import type { Candidate, Citation, Comparison, ToolEvent } from "@/src/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  toolEvents?: ToolEvent[];
  cards?: Candidate[];
  comparison?: Comparison | null;
  citations?: Citation[];
}

interface Interrupt {
  type: string;
  question: string;
}

interface ServiceStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
}
interface Health {
  llm: { enabled: boolean; model: string | null; baseURL?: string };
  postgres: ServiceStatus;
  redis: ServiceStatus;
  langfuse: { configured: boolean };
  dataMode: "postgres" | "memory";
  cacheMode: "redis" | "memory";
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const SAMPLES = [
  "15 万左右，家用，有充电桩，推荐几款",
  "20 万以内 SUV，经常跑长途",
  "10 万左右代步小车有哪些",
];

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => uid());
  const [traceId, setTraceId] = useState<string>("");
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [interrupt, setInterrupt] = useState<Interrupt | null>(null);
  const [phone, setPhone] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceData, setTraceData] = useState<any>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ⭐ 刷新后恢复：从 localStorage 取 sessionId，再回读数据库里的对话
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("car-advisor-session") : null;
    if (!saved) return;
    setSessionId(saved);
    (async () => {
      try {
        const r = await fetch(`/api/session/${saved}`);
        if (!r.ok) return;
        const data = await r.json();
        const msgs = (data.session?.messages ?? []).map((m: any) => ({
          id: uid(),
          role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          text: m.content ?? "",
        }));
        if (msgs.length) setMessages(msgs);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, interrupt]);

  const patch = (id: string, updater: (m: Message) => Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  };

  async function consumeSSE(res: Response, onEvent: (event: string, data: any) => void) {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("响应体为空");
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data) {
          try {
            onEvent(event, JSON.parse(data));
          } catch {
            /* 忽略不完整数据 */
          }
        }
      }
    }
  }

  async function request(payload: { message?: string; resume?: string }, assistantId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setInterrupt(null);
    setQuickReplies([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...payload }),
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`请求失败：${res.status}`);

      await consumeSSE(res, (event, data) => {
        switch (event) {
          case "session":
            setSessionId(data.sessionId);
            localStorage.setItem("car-advisor-session", data.sessionId);
            break;
          case "trace":
            setTraceId(data.traceId);
            break;
          case "tool":
            patch(assistantId, (m) => ({ ...m, toolEvents: [...(m.toolEvents ?? []), data as ToolEvent] }));
            break;
          case "card":
            patch(assistantId, (m) => ({ ...m, cards: [...(m.cards ?? []), data as Candidate] }));
            break;
          case "comparison":
            patch(assistantId, (m) => ({ ...m, comparison: data as Comparison }));
            break;
          case "citation":
            patch(assistantId, (m) => ({ ...m, citations: [...(m.citations ?? []), data as Citation] }));
            break;
          case "delta":
            patch(assistantId, (m) => ({ ...m, text: m.text + data.text }));
            break;
          case "interrupt":
            setInterrupt(data as Interrupt);
            break;
          case "quickReplies":
            setQuickReplies(data.options ?? []);
            break;
          case "notice":
            setNotice(data.detail ? `${data.message}：${data.detail}` : data.message);
            break;
          case "error":
            setError(data.message ?? "发生未知错误");
            break;
          case "done":
            patch(assistantId, (m) => ({ ...m, streaming: false }));
            break;
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
        patch(assistantId, (m) => ({ ...m, streaming: false }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      patch(assistantId, (m) => ({ ...m, streaming: false }));
    }
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const assistantId = uid();
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", text: content },
      { id: assistantId, role: "assistant", text: "", streaming: true },
    ]);
    setInput("");
    void request({ message: content }, assistantId);
  }

  function resume(value: string) {
    if (busy) return;
    const assistantId = uid();
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", text: value },
      { id: assistantId, role: "assistant", text: "", streaming: true },
    ]);
    setPhone("");
    void request({ resume: value }, assistantId);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function newSession() {
    const id = uid();
    localStorage.setItem("car-advisor-session", id);
    setSessionId(id);
    setMessages([]);
    setQuickReplies([]);
    setInterrupt(null);
    setTraceId("");
    setError("");
    setNotice("");
  }

  async function openTrace() {
    if (!traceId) return;
    setTraceOpen(true);
    setTraceLoading(true);
    try {
      const r = await fetch(`/api/trace/${traceId}`);
      setTraceData(await r.json());
    } catch (e) {
      setTraceData({ error: (e as Error).message, spans: [] });
    } finally {
      setTraceLoading(false);
    }
  }

  return (
    <div className="app">
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
          <button className="badge trace-btn" onClick={newSession}>
            新对话
          </button>
          {traceId && (
            <button className="badge trace-btn" onClick={openTrace}>
              查看 Trace
            </button>
          )}
        </div>
      </header>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <div className="empty">
              <h2>告诉我预算和用途，帮你把选车想清楚</h2>
              <p>我会用结构化车型数据筛选，再结合真实评测口碑给你推荐</p>
              <div className="samples">
                {SAMPLES.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="avatar">{m.role === "user" ? "我" : "懂"}</div>
              <div className="bubble">
                {m.toolEvents && m.toolEvents.length > 0 && (
                  <div className="tools">
                    {m.toolEvents.map((t, i) => (
                      <div key={i} className={`tool ${t.ok ? "ok" : ""}`}>
                        <span className="dot" />
                        <span>{toolLabel(t.name)}</span>
                        <span>{t.summary}</span>
                        {t.ms != null && <span className="ms">{t.ms}ms</span>}
                      </div>
                    ))}
                  </div>
                )}

                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text || (m.streaming ? "…" : "")) }} />

                {m.cards && m.cards.length > 0 && (
                  <div className="cards">
                    {m.cards.map((c) => (
                      <div className="card" key={c.modelId}>
                        <h3>
                          {c.brand} {c.series}
                        </h3>
                        <div className="meta">
                          {c.variantName} · {c.level} · {c.energyType} · {c.seats} 座
                        </div>
                        <div className="price">{c.price.toFixed(2)} 万</div>
                        <div>
                          {c.tags.map((t) => (
                            <span className="tag" key={t}>
                              {t}
                            </span>
                          ))}
                        </div>
                        <ul>
                          {c.why.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                        <ul className="neg">
                          {c.tradeoffs.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {m.comparison && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>项目</th>
                          {m.comparison.columns.map((c) => (
                            <th key={c.modelId}>{c.title}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {m.comparison.rows.map((r) => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            {r.values.map((v, i) => (
                              <td key={i}>{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {m.citations && m.citations.length > 0 && (
                  <div className="citations">
                    {m.citations.map((c, i) => (
                      <span className="citation" key={i} title={c.detail}>
                        {c.type === "review" ? "口碑" : "参数"} · {c.title}
                      </span>
                    ))}
                  </div>
                )}

                {interrupt && m.id === messages[messages.length - 1]?.id && (
                  <div className="interrupt">
                    <p>{interrupt.question}</p>
                    {interrupt.type === "phone" ? (
                      <div className="actions">
                        <input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="输入 11 位手机号"
                          inputMode="numeric"
                        />
                        <button className="primary" onClick={() => resume(phone)} disabled={busy}>
                          提交
                        </button>
                        <button className="ghost" onClick={() => resume("取消")} disabled={busy}>
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="actions">
                        <button className="primary" onClick={() => resume("确认")} disabled={busy}>
                          确认预约
                        </button>
                        <button className="ghost" onClick={() => resume("取消")} disabled={busy}>
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {quickReplies.length > 0 && m.id === messages[messages.length - 1]?.id && !interrupt && (
                  <div className="quick">
                    {quickReplies.map((q) => (
                      <button key={q} onClick={() => send(q)} disabled={busy}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {notice && <div className="tool" style={{ color: "#b45309" }}>ℹ️ {notice}</div>}
          {error && <div className="tool" style={{ color: "#b91c1c" }}>⚠️ {error}</div>}
          <div ref={bottomRef} />
        </div>

        <div className="composer">
          <textarea
            rows={1}
            value={input}
            placeholder="说说你的预算和用车场景，例如：15 万左右，家用，有充电桩"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          {busy ? (
            <button className="stop" onClick={stop}>
              停止
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={!input.trim()}>
              发送
            </button>
          )}
        </div>
      </main>

      <div className="footer-note">
        演示数据（虚构车型），不构成购买建议
        {traceId && (
          <>
            {" · "}
            <button className="link" onClick={openTrace}>
              trace: {traceId.slice(0, 8)}…
            </button>
          </>
        )}
      </div>

      {traceOpen && (
        <div className="modal" onClick={() => setTraceOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Trace 详情</h3>
              <button onClick={() => setTraceOpen(false)}>关闭</button>
            </div>

            {traceLoading && <p className="muted">加载中…</p>}

            {traceData && !traceLoading && (
              <>
                <div className="trace-meta">
                  <span>ID：{traceData.id}</span>
                  <span>总耗时：{traceData.durationMs ?? "-"} ms</span>
                  <span>会话：{traceData.sessionId}</span>
                </div>
                <div className="trace-list">
                  {(traceData.spans ?? []).map((sp: any, i: number) => (
                    <div className="trace-item" key={i}>
                      <div className="trace-name">
                        <span>{sp.name}</span>
                        <span className="ms">{sp.durationMs ?? 0} ms</span>
                      </div>
                      <pre>{JSON.stringify({ input: sp.input, output: sp.output }, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function toolLabel(name: string): string {
  const map: Record<string, string> = {
    search_cars: "筛选车型",
    compare_cars: "生成对比",
    estimate_price: "估算落地价",
    search_reviews: "检索口碑",
    create_test_drive_lead: "提交预约",
    get_car_detail: "查询详情",
  };
  return map[name] ?? name;
}

/** 轻量 Markdown 渲染：只支持 **加粗**、换行、表格由组件渲染 */
function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}
