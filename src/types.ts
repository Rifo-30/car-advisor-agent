// 全局类型定义
export type EnergyType = "燃油" | "混动" | "纯电";

export interface Variant {
  id: string;
  name: string;
  guidePrice: number; // 万元
  rangeKm?: number;
  powerKw: number;
  lengthMm: number;
  wheelbaseMm: number;
  fuelConsumption?: number; // L/100km
  config: string[];
}

export interface CarModel {
  id: string;
  brand: string;
  series: string;
  level: string;
  energyType: EnergyType;
  seats: number;
  bodyType: string;
  launchYear: number;
  tags: string[];
  description: string;
  variants: Variant[];
}

export interface Review {
  id: string;
  modelId: string;
  source: "媒体评测" | "车主口碑";
  title: string;
  content: string;
  rating: number;
  sentiment: "positive" | "negative" | "mixed";
  publishedAt: string;
}

export interface Constraints {
  budgetMin?: number;
  budgetMax?: number;
  energy?: EnergyType[];
  seats?: number;
  bodyType?: string[];
  usage?: string[];
  charging?: boolean;
  city?: string;
}

export type Stage =
  | "clarify"
  | "filter"
  | "recommend"
  | "compare"
  | "quote"
  | "confirm"
  | "done";

export interface Citation {
  type: "spec" | "review";
  title: string;
  detail: string;
}

export interface Candidate {
  modelId: string;
  brand: string;
  series: string;
  level: string;
  energyType: EnergyType;
  seats: number;
  price: number;
  variantId: string;
  variantName: string;
  why: string[];
  tradeoffs: string[];
  tags: string[];
}

export interface Recommendation {
  summary: string;
  candidates: Candidate[];
}

export interface PendingConfirm {
  type: "test_drive";
  modelId: string;
  city: string;
  phoneMasked: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  id: string;
  stage: Stage;
  constraints: Constraints;
  candidates: Candidate[];
  history: ChatMessage[];
  pendingConfirm?: PendingConfirm;
  turns: number;
  lastComparison?: string[];
}

export interface Comparison {
  columns: Array<{ modelId: string; title: string }>;
  rows: Array<{ label: string; values: string[] }>;
}

export interface ToolEvent {
  turnId?: string;
  name: string;
  args?: unknown;
  summary?: string;
  ok?: boolean;
  ms?: number;
}
