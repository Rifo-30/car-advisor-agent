"use client";

import type { Interrupt, Message } from "./types";
import { renderMarkdown, toolLabel } from "./utils";

interface Props {
  message: Message;
  isLast: boolean;
  interrupt: Interrupt | null;
  phone: string;
  busy: boolean;
  onPhoneChange: (value: string) => void;
  onResume: (value: string) => void;
  quickReplies: string[];
  onQuickReply: (value: string) => void;
}

export default function MessageItem({
  message: m,
  isLast,
  interrupt,
  phone,
  busy,
  onPhoneChange,
  onResume,
  quickReplies,
  onQuickReply,
}: Props) {
  return (
    <div className={`msg ${m.role}`}>
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

        {interrupt && isLast && (
          <div className="interrupt">
            <p>{interrupt.question}</p>
            {interrupt.type === "phone" ? (
              <div className="actions">
                <input
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  placeholder="输入 11 位手机号"
                  inputMode="numeric"
                />
                <button className="primary" onClick={() => onResume(phone)} disabled={busy}>
                  提交
                </button>
                <button className="ghost" onClick={() => onResume("取消")} disabled={busy}>
                  取消
                </button>
              </div>
            ) : (
              <div className="actions">
                <button className="primary" onClick={() => onResume("确认")} disabled={busy}>
                  确认预约
                </button>
                <button className="ghost" onClick={() => onResume("取消")} disabled={busy}>
                  取消
                </button>
              </div>
            )}
          </div>
        )}

        {quickReplies.length > 0 && isLast && !interrupt && (
          <div className="quick">
            {quickReplies.map((q) => (
              <button key={q} onClick={() => onQuickReply(q)} disabled={busy}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
