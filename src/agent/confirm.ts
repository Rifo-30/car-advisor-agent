// ============================================================
// 确认意图解析（生产级：否定优先 + 模棱两可一律重新询问）
// 面试要点：高危操作不能只靠"含关键词"判断，
// 必须先排除否定表达，再匹配肯定；无法判断时绝不默认执行。
// ============================================================
export type ConfirmDecision = "confirm" | "cancel" | "ambiguous";

// 模棱两可表达（优先于否定/肯定判断）
const AMBIGUOUS = /(不确定|不清楚|再看看|再想想|考虑一下|等等|随便|都行)/;
// 否定 / 取消（必须先于肯定判断）
const CANCEL = /(不|别|取消|算了|不要|不用|不行|不好|停|关闭|先不|\bno\b|\bnope\b)/i;
// 肯定 / 确认
const CONFIRM = /(确认|确定|是的|好的|可以|没问题|同意|对的|行|ok|okay|嗯)/i;

export function parseConfirmDecision(input: unknown): ConfirmDecision {
  const text = String(input ?? "").trim();
  if (!text) return "ambiguous";
  if (AMBIGUOUS.test(text)) return "ambiguous";
  if (CANCEL.test(text)) return "cancel";   // 否定优先：'不好'/'不行'/'确认取消' → cancel
  if (CONFIRM.test(text)) return "confirm"; // '好的'/'可以'/'确认' → confirm
  return "ambiguous";
}
