// 将口碑检索结果整理成“直接回答 + 证据”，避免只罗列优缺点
import type { Review } from "../types";

const TOPICS: Array<{ pattern: RegExp; label: string; evidence: RegExp }> = [
  { pattern: /噪音|隔音|风噪|胎噪|nvh/i, label: "高速噪音与隔音", evidence: /噪音|隔音|风噪|胎噪|NVH/i },
  { pattern: /空间|后排|后备箱|头部/, label: "空间表现", evidence: /空间|后排|后备箱|头部|座椅/ },
  { pattern: /油耗|省油|用车成本|保养/, label: "油耗与用车成本", evidence: /油耗|省油|保养|成本/ },
  { pattern: /续航|充电|补能|电耗/, label: "续航与充电", evidence: /续航|充电|补能|电耗|家充/ },
  { pattern: /动力|加速|超车/, label: "动力表现", evidence: /动力|加速|超车|爬坡/ },
  { pattern: /底盘|滤震|舒适/, label: "底盘与舒适性", evidence: /底盘|滤震|舒适|隔音/ },
  { pattern: /车机|智能|辅助驾驶|智驾/, label: "车机与智能体验", evidence: /车机|智能|辅助驾驶|智驾/ },
  { pattern: /缺点|不足|问题|槽点/, label: "主要缺点", evidence: /缺点|不足|一般|偏|弱|慢|吃力|较高|担心|塑料|卡顿|噪音|风噪|胎噪/ },
];

function sentences(text: string): string[] {
  return text.split(/[。！？\n]/).map((item) => item.trim()).filter(Boolean);
}

export function buildReviewFocus(question: string, reviews: Review[]): string {
  const topic = TOPICS.find((item) => item.pattern.test(question));
  if (!topic) return "";

  const evidence: string[] = [];
  for (const review of reviews) {
    for (const sentence of sentences(review.content)) {
      if (topic.evidence.test(sentence)) evidence.push(sentence);
      if (evidence.length >= 2) break;
    }
    if (evidence.length >= 2) break;
  }

  if (!evidence.length) {
    return `**直接结论**：检索到的口碑没有直接覆盖“${topic.label}”，建议不要把有限样本当作确定结论。`;
  }

  if (topic.label === "高速噪音与隔音") {
    return `**直接结论**：检索到的口碑显示隔音表现一般，但缺少专门的高速实测数据，不能断言高速噪音一定很大；建议试驾时重点确认风噪和胎噪。证据：${evidence.join("；")}。`;
  }

  if (topic.label === "主要缺点") {
    return `**直接结论**：检索到的口碑中提到的主要不足包括：${evidence.join("；")}。这些是车主或媒体反馈，不代表每台车都会出现。`;
  }

  return `**直接结论**：关于${topic.label}，检索到的口碑提到：${evidence.join("；")}。`;
}
