"use client";

interface Props {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}

export default function Composer({ value, busy, onChange, onSend, onStop }: Props) {
  return (
    <div className="composer">
      <textarea
        rows={1}
        value={value}
        placeholder="说说你的预算和用车场景，例如：15 万左右，家用，有充电桩"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      {busy ? (
        <button className="stop" onClick={onStop}>
          停止
        </button>
      ) : (
        <button onClick={onSend} disabled={!value.trim()}>
          发送
        </button>
      )}
    </div>
  );
}
