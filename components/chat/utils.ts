export function getUserId(): string {
  if (typeof window === "undefined") return "anonymous";
  let id = localStorage.getItem("car-advisor-user");
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `u-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("car-advisor-user", id);
  }
  return id;
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const SAMPLES = [
  "15 万左右，家用，有充电桩，推荐几款",
  "20 万以内 SUV，经常跑长途",
  "10 万左右代步小车有哪些",
];

export function toolLabel(name: string): string {
  const map: Record<string, string> = {
    search_cars: "筛选车型",
    compare_cars: "生成对比",
    estimate_price: "估算落地价",
    search_reviews: "检索口碑",
    create_test_drive_lead: "提交预约",
    get_car_detail: "查询详情",
  };
  return map[name] ?? name;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 轻量 Markdown 渲染：先转义 HTML，再支持 **加粗** 与换行 */
export function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}
