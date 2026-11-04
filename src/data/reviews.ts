import type { Review } from "../types";

// ⚠️ 演示数据：内容为虚构的评测/口碑摘要，用于 RAG 检索演示。
export const REVIEWS: Review[] = [
  { id: "r-xh-a5-1", modelId: "xh-a5", source: "媒体评测", title: "家用轿车的稳妥选择", content: "实测百公里油耗 5.8L，市区通勤很省。底盘偏舒适，隔音一般，高速风噪明显。后排空间够用，后备箱规整。", rating: 4.2, sentiment: "positive", publishedAt: "2026-03-12" },
  { id: "r-xh-a5-2", modelId: "xh-a5", source: "车主口碑", title: "开了一年，省心", content: "保养便宜，油耗稳定在 6L 左右。缺点是动力偏弱，超车要提前踩。车机偶尔卡顿。", rating: 4.0, sentiment: "mixed", publishedAt: "2026-05-20" },
  { id: "r-xh-a7-1", modelId: "xh-a7", source: "媒体评测", title: "插混家轿的均衡解法", content: "纯电续航实测约 105km，市区基本用电。馈电油耗 4.5L，长途不焦虑。后排腿部空间充裕，座椅偏硬。", rating: 4.5, sentiment: "positive", publishedAt: "2026-04-02" },
  { id: "r-xh-a7-2", modelId: "xh-a7", source: "车主口碑", title: "没有家充也敢买", content: "当油车开油耗也不高，适合没固定车位的人。缺点是后备箱被电池占了一点空间。", rating: 4.3, sentiment: "positive", publishedAt: "2026-06-11" },
  { id: "r-yt-x3-1", modelId: "yt-x3", source: "媒体评测", title: "底盘扎实的紧凑 SUV", content: "通过性不错，烂路滤震干脆。1.5T 动力够用，满载爬坡稍吃力。车机反应偏慢。", rating: 4.1, sentiment: "mixed", publishedAt: "2026-02-18" },
  { id: "r-yt-x3-2", modelId: "yt-x3", source: "车主口碑", title: "空间利用率高", content: "后排能放平，装大件方便。市区油耗 8L 左右，能接受。隔音一般。", rating: 4.0, sentiment: "positive", publishedAt: "2026-05-06" },
  { id: "r-yt-x5-1", modelId: "yt-x5", source: "媒体评测", title: "有娃家庭的务实之选", content: "后排空间和后备箱都很大，儿童座椅安装方便。混动系统平顺，馈电油耗 5.2L。第三排没有，七座需求要另选。", rating: 4.4, sentiment: "positive", publishedAt: "2026-04-25" },
  { id: "r-yt-x5-2", modelId: "yt-x5", source: "车主口碑", title: "家用很满意", content: "后排空调出风口很实用，夏天后排不闷。缺点是车身大，老小区停车费劲。", rating: 4.2, sentiment: "positive", publishedAt: "2026-07-01" },
  { id: "r-jl-e3-1", modelId: "jl-e3", source: "媒体评测", title: "真实续航表现不错", content: "城市工况实测续航约 480km，高速约 380km。热泵空调冬季表现较好。后排头部空间一般。", rating: 4.3, sentiment: "positive", publishedAt: "2026-03-30" },
  { id: "r-jl-e3-2", modelId: "jl-e3", source: "车主口碑", title: "有家充就很香", content: "每天通勤 40km，一周充一次。没有家充的话建议慎重。车机流畅度不错。", rating: 4.4, sentiment: "positive", publishedAt: "2026-06-18" },
  { id: "r-jl-e5-1", modelId: "jl-e5", source: "媒体评测", title: "大空间纯电 SUV", content: "后排和后备箱都很宽敞，800V 快充 20 分钟补能到 80%。高速续航打折约 25%。", rating: 4.5, sentiment: "positive", publishedAt: "2026-05-09" },
  { id: "r-jl-e5-2", modelId: "jl-e5", source: "车主口碑", title: "长途也能接受", content: "服务区快充很方便，就是节假日排队。底盘舒适，隔音好。", rating: 4.3, sentiment: "positive", publishedAt: "2026-07-22" },
  { id: "r-bc-s1-1", modelId: "bc-s1", source: "媒体评测", title: "十万级通勤电车", content: "城市代步足够，实测续航 400km 左右。高速风噪偏大，内饰塑料感明显。", rating: 3.9, sentiment: "mixed", publishedAt: "2026-01-15" },
  { id: "r-bc-s1-2", modelId: "bc-s1", source: "车主口碑", title: "通勤成本很低", content: "每月电费不到 100 块。缺点是后排空间一般，长途不太舒服。", rating: 4.0, sentiment: "positive", publishedAt: "2026-04-11" },
  { id: "r-bc-s3-1", modelId: "bc-s3", source: "媒体评测", title: "智驾是最大亮点", content: "高速领航辅助表现稳定，城市道路还需接管。内饰质感好，后排空间充裕。", rating: 4.4, sentiment: "positive", publishedAt: "2026-05-28" },
  { id: "r-bc-s3-2", modelId: "bc-s3", source: "车主口碑", title: "科技感强", content: "车机流畅，语音识别准。缺点是品牌保值率还不确定。", rating: 4.2, sentiment: "mixed", publishedAt: "2026-08-03" },
  { id: "r-cf-t5-1", modelId: "cf-t5", source: "媒体评测", title: "七座燃油大块头", content: "第三排能坐成年人但偏局促。2.0T 动力充沛，市区油耗 10L 左右，高速 8.5L。", rating: 4.0, sentiment: "mixed", publishedAt: "2026-02-27" },
  { id: "r-cf-t5-2", modelId: "cf-t5", source: "车主口碑", title: "全家出行够用", content: "七座应急很方便，平时当五座开。缺点是油耗高，停车不方便。", rating: 3.9, sentiment: "mixed", publishedAt: "2026-06-05" },
  { id: "r-cf-t7-1", modelId: "cf-t7", source: "媒体评测", title: "六座混动的舒适派", content: "二排独立座椅舒适度高，混动系统安静平顺。第三排空间一般，适合孩子。", rating: 4.4, sentiment: "positive", publishedAt: "2026-06-21" },
  { id: "r-cf-t7-2", modelId: "cf-t7", source: "车主口碑", title: "二排很舒服", content: "老人坐二排很满意。馈电油耗 6.5L，比预期好。车机功能偏少。", rating: 4.2, sentiment: "positive", publishedAt: "2026-08-14" },
  { id: "r-xh-m1-1", modelId: "xh-m1", source: "媒体评测", title: "城市代步小精灵", content: "车身小巧好停车，转弯半径小。续航实测 270km 左右，适合短途。安全配置一般。", rating: 3.8, sentiment: "mixed", publishedAt: "2026-03-05" },
  { id: "r-xh-m1-2", modelId: "xh-m1", source: "车主口碑", title: "买菜接娃神器", content: "家里第二台车很合适，充电方便。缺点是不适合上高速。", rating: 4.1, sentiment: "positive", publishedAt: "2026-05-17" },
  { id: "r-yt-x1-1", modelId: "yt-x1", source: "媒体评测", title: "入门价位的实在选择", content: "配置简单但够用，油耗 6.5L 左右。隔音和底盘质感一般。", rating: 3.7, sentiment: "mixed", publishedAt: "2026-01-22" },
  { id: "r-yt-x1-2", modelId: "yt-x1", source: "车主口碑", title: "第一台车够用", content: "预算有限的话很合适，保养便宜。缺点是动力弱，内饰朴素。", rating: 3.8, sentiment: "mixed", publishedAt: "2026-04-30" }
];
