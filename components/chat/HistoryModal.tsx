"use client";

import type { SessionSummary } from "./types";
import { formatTime } from "./utils";

interface Props {
  open: boolean;
  loading: boolean;
  error: string;
  sessions: SessionSummary[];
  onRefresh: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export default function HistoryModal({
  open,
  loading,
  error,
  sessions,
  onRefresh,
  onClose,
  onSelect,
}: Props) {
  if (!open) return null;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-panel history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>历史会话</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onRefresh}>刷新</button>
            <button onClick={onClose}>关闭</button>
          </div>
        </div>

        {loading && <p className="muted">加载中…</p>}
        {!loading && error && <p className="muted">{error}</p>}
        {!loading && !error && sessions.length === 0 && (
          <p className="muted">暂无历史会话，先聊几句吧。</p>
        )}

        <div className="history-list">
          {sessions.map((s) => (
            <button key={s.id} className="history-item" onClick={() => onSelect(s.id)}>
              <div className="history-title">{s.title}</div>
              <div className="history-meta">
                <span>{formatTime(s.updatedAt)}</span>
                <span>{s.messageCount} 条消息</span>
                <span className="tag">{s.stage}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
