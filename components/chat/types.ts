import type { Candidate, Citation, Comparison, ToolEvent } from "@/src/types";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  toolEvents?: ToolEvent[];
  cards?: Candidate[];
  comparison?: Comparison | null;
  citations?: Citation[];
}

export interface Interrupt {
  type: string;
  question: string;
}

export interface ServiceStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
}

export interface Health {
  llm: { enabled: boolean; model: string | null; baseURL?: string };
  postgres: ServiceStatus;
  redis: ServiceStatus;
  langfuse: { configured: boolean };
  dataMode: "postgres" | "memory";
  cacheMode: "redis" | "memory";
}

export interface SessionSummary {
  id: string;
  title: string;
  stage: string;
  messageCount: number;
  updatedAt: string | null;
}
