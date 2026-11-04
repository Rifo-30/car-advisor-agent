// ============================================================
// 护栏层：广告法、价格免责、PII、注入检测
// 面试要点：安全不能只靠 prompt，必须在代码层做「最后一道闸」。
// ============================================================
import { createHash } from "node:crypto";

const ABSOLUTE_WORD_RULES: Array<[RegExp, string]> = [
  [/最低价/g, "较低价格"],
  [/最便宜/g, "价格较低"],
  [/最好的/g, "较好的"],
  [/最强/g, "较强"],
  [/第一品牌/g, "知名品牌"],
  [/唯一/g, "少见"],
  [/绝对/g, "通常"],
  [/顶级/g, "优秀"],
  [/吊打/g, "优于"],
  [/秒杀/g, "优于"],
  [/垃圾/g, "表现一般"],
  [/保证/g, "通常"],
];

const INJECTION_PATTERNS: RegExp[] = [
  /忽略(以上|之前|前面|上述).{0,8}(指令|规则|要求)/,
  /ignore\s+(all\s+)?(previous|above)\s+instructions?/i,
  /system\s*prompt/i,
  /你现在是.{0,20}(管理员|root|开发者模式)/,
  /输出.{0,10}(系统提示|系统指令)/,
];

export interface GuardResult {
  text: string;
  warnings: string[];
}

/** 输出侧护栏：绝对化用语替换 + 价格免责声明 */
export function applyOutputGuardrails(text: string): GuardResult {
  let out = text;
  const warnings: string[] = [];

  for (const [re, replacement] of ABSOLUTE_WORD_RULES) {
    if (re.test(out)) {
      warnings.push(`广告法用语已替换: ${re.source}`);
      out = out.replace(re, replacement);
    }
  }

  // 只有真正出现「数字 + 万」的报价时才补免责声明（避免自我介绍被误判）
  if (/\d+(?:\.\d+)?\s*万/.test(out) && !out.includes("以经销商")) {
    out += "\n\n> 以上价格为参考估算，以经销商实际报价及官方配置表为准。";
    warnings.push("已补充价格免责声明");
  }

  return { text: out, warnings };
}

/** 输入侧护栏：注入检测 */
export function detectInjection(input: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(input));
}

export function sanitizeInput(input: string): string {
  return input.slice(0, 2000).trim();
}

/** PII 脱敏展示 */
export function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

/** Demo 版加密：真实系统应使用 KMS + 对称加密 */
export function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex").slice(0, 32);
}

export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}
