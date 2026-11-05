"use client";

import { useEffect, useRef, useState } from "react";
import Composer from "./chat/Composer";
import Header from "./chat/Header";
import HistoryModal from "./chat/HistoryModal";
import MessageItem from "./chat/MessageItem";
import TraceModal from "./chat/TraceModal";
import type { Health, Interrupt, Message, SessionSummary } from "./chat/types";
import { getUserId, SAMPLES, uid } from "./chat/utils";

export default function Chat() {
  // ---------- 会话与消息 ----------
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => uid());

  // ---------- 人机协同 ----------
  const [interrupt, setInterrupt] = useState<Interrupt | null>(null);
  const [phone, setPhone] = useState("");
  const [quickReplies, setQuickReplies] = useState<string[]>([]);

  // ---------- 状态与提示 ----------
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // ---------- Trace ----------
  const [traceId, setTraceId] = useState("");
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceData, setTraceData] = useState<any>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // ---------- 历史会话 ----------
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<SessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ⭐ 刷新后恢复：从 localStorage 取 sessionId，再回读数据库里的对话
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("car-advisor-session") : null;
    if (!saved) return;
    (async () => {
      try {
        setSessionId(saved);
        const r = await fetch(`/api/session/${saved}`, { headers: { "x-user-id": getUserId() } });
        if (!r.ok) return;
        const data = await r.json();
        const msgs = (data.session?.messages ?? []).map((m: any) => ({
          id: uid(),
          role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          text: m.content ?? "",
        }));
        if (msgs.length) setMessages(msgs);
      } catch {
        /* 忽略：恢复失败时从空白会话开始 */
      }
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
        headers: { "Content-Type": "application/json", "x-user-id": getUserId() },
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
            patch(assistantId, (m) => ({ ...m, toolEvents: [...(m.toolEvents ?? []), data] }));
            break;
          case "card":
            patch(assistantId, (m) => ({ ...m, cards: [...(m.cards ?? []), data] }));
            break;
          case "comparison":
            patch(assistantId, (m) => ({ ...m, comparison: data }));
            break;
          case "citation":
            patch(assistantId, (m) => ({ ...m, citations: [...(m.citations ?? []), data] }));
            break;
          case "delta":
            patch(assistantId, (m) => ({ ...m, text: m.text + data.text }));
            break;
          case "interrupt":
            setInterrupt(data);
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
      }
      patch(assistantId, (m) => ({ ...m, streaming: false }));
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

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const r = await fetch("/api/sessions?limit=50", { headers: { "x-user-id": getUserId() } });
      const data = await r.json();
      setHistoryList(data.sessions ?? []);
      if (data.note) setHistoryError(data.note);
    } catch (e) {
      setHistoryError((e as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadSession(id: string) {
    try {
      const r = await fetch(`/api/session/${id}`, { headers: { "x-user-id": getUserId() } });
      if (!r.ok) return;
      const data = await r.json();
      const msgs = (data.session?.messages ?? []).map((m: any) => ({
        id: uid(),
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        text: m.content ?? "",
      }));
      setSessionId(id);
      localStorage.setItem("car-advisor-session", id);
      setMessages(msgs);
      setInterrupt(null);
      setQuickReplies([]);
      setTraceId("");
      setError("");
      setNotice("");
      setHistoryOpen(false);
    } catch {
      /* 忽略：加载失败时保留当前会话 */
    }
  }

  return (
    <div className="app">
      <Header
        health={health}
        traceId={traceId}
        onHistory={openHistory}
        onNewSession={newSession}
        onTrace={openTrace}
      />

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

          {messages.map((m, i) => (
            <MessageItem
              key={m.id}
              message={m}
              isLast={i === messages.length - 1}
              interrupt={interrupt}
              phone={phone}
              busy={busy}
              onPhoneChange={setPhone}
              onResume={resume}
              quickReplies={quickReplies}
              onQuickReply={send}
            />
          ))}

          {notice && <div className="tool" style={{ color: "#b45309" }}>ℹ️ {notice}</div>}
          {error && <div className="tool" style={{ color: "#b91c1c" }}>⚠️ {error}</div>}
          <div ref={bottomRef} />
        </div>

        <Composer value={input} busy={busy} onChange={setInput} onSend={() => send(input)} onStop={stop} />
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

      <HistoryModal
        open={historyOpen}
        loading={historyLoading}
        error={historyError}
        sessions={historyList}
        onRefresh={openHistory}
        onClose={() => setHistoryOpen(false)}
        onSelect={loadSession}
      />

      <TraceModal open={traceOpen} loading={traceLoading} data={traceData} onClose={() => setTraceOpen(false)} />
    </div>
  );
}
