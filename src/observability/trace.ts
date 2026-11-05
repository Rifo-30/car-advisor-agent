// ============================================================
// 可观测层：Langfuse（可选）+ 本地 trace（兜底）
// 面试要点：
// 1) 一次请求 = 一个 trace，每个步骤 = 一个 span；
// 2) 没接平台时也要能查（本地 trace 可被 /api/trace/:id 读取）。
// ============================================================
import { randomUUID } from "node:crypto";
import { Langfuse } from "langfuse";
import { getTraceRecord, listTraceRecords, saveTraceRecord } from "../db/repo";

export type LocalSpan = {
  name: string;
  input?: unknown;
  output?: unknown;
  startMs: number;
  durationMs?: number;
};

export type LocalTrace = {
  id: string;
  name: string;
  sessionId: string;
  input?: unknown;
  output?: unknown;
  startMs: number;
  durationMs?: number;
  spans: LocalSpan[];
};

const localTraces = new Map<string, LocalTrace>();
const MAX_LOCAL_TRACES = 200;

let lf: Langfuse | null = null;
let lfDisabled = false;

function getLangfuse(): Langfuse | null {
  if (lfDisabled) return null;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return null;
  if (!lf) {
    try {
      lf = new Langfuse({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
      });
    } catch (err) {
      console.warn("[trace] Langfuse 初始化失败，使用本地 trace:", (err as Error).message);
      lfDisabled = true;
      return null;
    }
  }
  return lf;
}

export interface SpanHandle {
  end(output?: unknown): void;
}

export interface TraceHandle {
  id: string;
  span(name: string, input?: unknown): SpanHandle;
  /** 补记一个已完成的 span（例如工具调用，耗时已知） */
  addSpan(name: string, input: unknown, output: unknown, durationMs: number): void;
  end(output?: unknown): void;
}

export function startTrace(name: string, sessionId: string, input?: unknown): TraceHandle {
  const id = randomUUID();
  const record: LocalTrace = { id, name, sessionId, input, startMs: Date.now(), spans: [] };
  localTraces.set(id, record);
  if (localTraces.size > MAX_LOCAL_TRACES) {
    const first = localTraces.keys().next().value;
    if (first) localTraces.delete(first);
  }

  const client = getLangfuse();
  let remoteTrace: any = null;
  if (client) {
    try {
      remoteTrace = (client as any).trace({ id, name, sessionId, input });
    } catch {
      remoteTrace = null;
    }
  }

  return {
    id,
    span(spanName: string, spanInput?: unknown): SpanHandle {
      const start = Date.now();
      const local: LocalSpan = { name: spanName, input: spanInput, startMs: start };
      record.spans.push(local);
      let remoteSpan: any = null;
      if (remoteTrace) {
        try { remoteSpan = remoteTrace.span({ name: spanName, input: spanInput }); } catch { remoteSpan = null; }
      }
      return {
        end(output?: unknown) {
          local.output = output;
          local.durationMs = Date.now() - start;
          if (remoteSpan) {
            try { remoteSpan.end({ output }); } catch { /* ignore */ }
          }
        },
      };
    },
    addSpan(spanName: string, spanInput: unknown, spanOutput: unknown, durationMs: number) {
      record.spans.push({
        name: spanName,
        input: spanInput,
        output: spanOutput,
        startMs: Date.now() - durationMs,
        durationMs,
      });
      if (remoteTrace) {
        try {
          const rs = remoteTrace.span({ name: spanName, input: spanInput });
          rs.end({ output: spanOutput });
        } catch { /* ignore */ }
      }
    },
    end(output?: unknown) {
      record.output = output;
      record.durationMs = Date.now() - record.startMs;
      if (remoteTrace) {
        try { remoteTrace.update({ output }); } catch { /* ignore */ }
      }
      // 异步 flush，不阻塞请求
      if (client) {
        (client as any).flushAsync?.().catch?.(() => {});
      }
      // ⭐ 持久化到 Postgres（重启不丢）
      void saveTraceRecord(record);
    },
  };
}

/** 追加一个 span（用于 trace 结束后才发生的步骤，如 LLM 润色） */
export function appendSpan(
  traceId: string,
  name: string,
  input: unknown,
  output: unknown,
  durationMs: number
): void {
  const record = localTraces.get(traceId);
  if (!record) return;
  record.spans.push({
    name,
    input,
    output,
    startMs: Date.now() - durationMs,
    durationMs,
  });
}

/** 重新结束 trace：会重算总耗时，把后续步骤算进去 */
export function finishTrace(traceId: string, output: unknown): void {
  const record = localTraces.get(traceId);
  if (!record) return;
  record.output = output;
  record.durationMs = Date.now() - record.startMs;
  void saveTraceRecord(record);
}

export interface TraceSummary {
  id: string;
  name: string;
  sessionId: string;
  startMs: number;
  durationMs: number | null;
  spanCount: number;
}

/** 最近的 trace 列表（新的在前） */
export function listLocalTraces(limit = 50): TraceSummary[] {
  return [...localTraces.values()]
    .sort((a, b) => b.startMs - a.startMs)
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      name: t.name,
      sessionId: t.sessionId,
      startMs: t.startMs,
      durationMs: t.durationMs ?? null,
      spanCount: t.spans.length,
    }));
}

export function getLocalTrace(id: string): LocalTrace | undefined {
  return localTraces.get(id);
}

/** 先查内存，再查 Postgres（重启后仍可读到） */
export async function getTrace(id: string): Promise<LocalTrace | null> {
  return localTraces.get(id) ?? (await getTraceRecord(id));
}

/** 合并内存 + Postgres 的 trace 列表 */
export async function listTraces(limit = 50): Promise<TraceSummary[]> {
  const mem = listLocalTraces(limit);
  if (mem.length >= limit) return mem;
  const db = (await listTraceRecords(limit)) as TraceSummary[];
  const seen = new Set(mem.map((t) => t.id));
  return [...mem, ...db.filter((t) => !seen.has(t.id))]
    .sort((a, b) => b.startMs - a.startMs)
    .slice(0, limit);
}
