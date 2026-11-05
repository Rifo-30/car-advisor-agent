"use client";

interface Props {
  open: boolean;
  loading: boolean;
  data: any;
  onClose: () => void;
}

export default function TraceModal({ open, loading, data, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Trace 详情</h3>
          <button onClick={onClose}>关闭</button>
        </div>

        {loading && <p className="muted">加载中…</p>}

        {data && !loading && (
          <>
            <div className="trace-meta">
              <span>ID：{data.id}</span>
              <span>总耗时：{data.durationMs ?? "-"} ms</span>
              <span>会话：{data.sessionId}</span>
            </div>
            <div className="trace-list">
              {(data.spans ?? []).map((sp: any, i: number) => (
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
  );
}
