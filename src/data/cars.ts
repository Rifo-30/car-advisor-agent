import type { CarModel } from "../types";

// ⚠️ 演示数据：品牌与车型均为虚构，参数为合理区间模拟值，不代表任何真实在售车型。
export const CARS: CarModel[] = [
  {
    id: "xh-a5",
    brand: "星海",
    series: "启航 A5",
    level: "紧凑型轿车",
    energyType: "燃油",
    seats: 5,
    bodyType: "轿车",
    launchYear: 2025,
    tags: ["省油", "保值", "通勤"],
    description: "主打经济省油的紧凑型家用轿车，保养便宜、保值率稳定。",
    variants: [
      { id: "xh-a5-c", name: "1.5T 舒适版", guidePrice: 12.98, powerKw: 125, lengthMm: 4700, wheelbaseMm: 2720, fuelConsumption: 5.9, config: ["倒车影像", "定速巡航", "LED大灯"] },
      { id: "xh-a5-z", name: "1.5T 尊贵版", guidePrice: 14.58, powerKw: 125, lengthMm: 4700, wheelbaseMm: 2720, fuelConsumption: 6.1, config: ["全景影像", "自适应巡航", "座椅加热"] }
    ]
  },
  {
    id: "xh-a7",
    brand: "星海",
    series: "启航 A7",
    level: "中型轿车",
    energyType: "混动",
    seats: 5,
    bodyType: "轿车",
    launchYear: 2026,
    tags: ["大空间", "低油耗", "家用"],
    description: "插混中型轿车，市区用电、长途用油，适合没有固定充电条件的家庭。",
    variants: [
      { id: "xh-a7-pro", name: "1.5T 混动 Pro", guidePrice: 16.98, rangeKm: 120, powerKw: 160, lengthMm: 4880, wheelbaseMm: 2820, fuelConsumption: 4.2, config: ["纯电续航120km", "L2辅助驾驶", "全景天幕"] },
      { id: "xh-a7-max", name: "1.5T 混动 Max", guidePrice: 18.98, rangeKm: 150, powerKw: 175, lengthMm: 4880, wheelbaseMm: 2820, fuelConsumption: 4.4, config: ["纯电续航150km", "座椅通风", "品牌音响"] }
    ]
  },
  {
    id: "yt-x3",
    brand: "云途",
    series: "远山 X3",
    level: "紧凑型SUV",
    energyType: "燃油",
    seats: 5,
    bodyType: "SUV",
    launchYear: 2025,
    tags: ["通过性", "空间", "家用"],
    description: "紧凑型燃油 SUV，空间利用率高，底盘扎实，适合路况一般的家庭。",
    variants: [
      { id: "yt-x3-15", name: "1.5T 两驱版", guidePrice: 13.98, powerKw: 130, lengthMm: 4620, wheelbaseMm: 2730, fuelConsumption: 6.8, config: ["倒车影像", "无钥匙进入", "自动空调"] },
      { id: "yt-x3-20", name: "2.0T 四驱版", guidePrice: 16.98, powerKw: 175, lengthMm: 4620, wheelbaseMm: 2730, fuelConsumption: 7.9, config: ["四驱系统", "全景影像", "座椅加热"] }
    ]
  },
  {
    id: "yt-x5",
    brand: "云途",
    series: "远山 X5",
    level: "中型SUV",
    energyType: "混动",
    seats: 5,
    bodyType: "SUV",
    launchYear: 2026,
    tags: ["大空间", "家用", "低油耗"],
    description: "混动中型 SUV，后排与后备箱空间突出，适合有娃家庭。",
    variants: [
      { id: "yt-x5-h", name: "1.5T 混动版", guidePrice: 17.98, rangeKm: 110, powerKw: 170, lengthMm: 4780, wheelbaseMm: 2830, fuelConsumption: 5.0, config: ["纯电续航110km", "后排空调出风口", "电动尾门"] },
      { id: "yt-x5-h4", name: "1.5T 混动四驱", guidePrice: 20.98, rangeKm: 100, powerKw: 200, lengthMm: 4780, wheelbaseMm: 2830, fuelConsumption: 5.6, config: ["四驱系统", "全景天窗", "座椅通风"] }
    ]
  },
  {
    id: "jl-e3",
    brand: "极岚",
    series: "光年 E3",
    level: "紧凑型SUV",
    energyType: "纯电",
    seats: 5,
    bodyType: "SUV",
    launchYear: 2026,
    tags: ["续航", "智能", "纯电"],
    description: "纯电紧凑型 SUV，主打真实续航与智能座舱，适合有充电条件的城市家庭。",
    variants: [
      { id: "jl-e3-550", name: "550km 两驱版", guidePrice: 15.98, rangeKm: 550, powerKw: 150, lengthMm: 4600, wheelbaseMm: 2750, config: ["L2辅助驾驶", "15.6英寸中控", "热泵空调"] },
      { id: "jl-e3-650", name: "650km 两驱版", guidePrice: 18.98, rangeKm: 650, powerKw: 170, lengthMm: 4600, wheelbaseMm: 2750, config: ["长续航电池", "座椅通风", "品牌音响"] }
    ]
  },
  {
    id: "jl-e5",
    brand: "极岚",
    series: "光年 E5",
    level: "中型SUV",
    energyType: "纯电",
    seats: 5,
    bodyType: "SUV",
    launchYear: 2026,
    tags: ["大空间", "快充", "纯电"],
    description: "纯电中型 SUV，空间大、支持高压快充，适合长途出行需求较多的家庭。",
    variants: [
      { id: "jl-e5-620", name: "620km 两驱版", guidePrice: 19.98, rangeKm: 620, powerKw: 180, lengthMm: 4820, wheelbaseMm: 2900, config: ["800V快充", "全景影像", "电动尾门"] },
      { id: "jl-e5-720", name: "720km 四驱版", guidePrice: 23.98, rangeKm: 720, powerKw: 320, lengthMm: 4820, wheelbaseMm: 2900, config: ["四驱", "空气悬架", "座椅按摩"] }
    ]
  },
  {
    id: "bc-s1",
    brand: "北辰",
    series: "星轨 S1",
    level: "紧凑型轿车",
    energyType: "纯电",
    seats: 5,
    bodyType: "轿车",
    launchYear: 2025,
    tags: ["性价比", "通勤", "纯电"],
    description: "十万级纯电轿车，用车成本低，适合城市通勤代步。",
    variants: [
      { id: "bc-s1-430", name: "430km 标准版", guidePrice: 11.98, rangeKm: 430, powerKw: 120, lengthMm: 4720, wheelbaseMm: 2760, config: ["倒车影像", "自动空调", "手机互联"] },
      { id: "bc-s1-510", name: "510km 长续航版", guidePrice: 13.58, rangeKm: 510, powerKw: 130, lengthMm: 4720, wheelbaseMm: 2760, config: ["L2辅助驾驶", "座椅加热", "无线充电"] }
    ]
  },
  {
    id: "bc-s3",
    brand: "北辰",
    series: "星轨 S3",
    level: "中型轿车",
    energyType: "纯电",
    seats: 5,
    bodyType: "轿车",
    launchYear: 2026,
    tags: ["智驾", "舒适", "纯电"],
    description: "纯电中型轿车，智能驾驶与舒适性配置突出，适合注重科技体验的用户。",
    variants: [
      { id: "bc-s3-600", name: "600km 智享版", guidePrice: 18.98, rangeKm: 600, powerKw: 200, lengthMm: 4920, wheelbaseMm: 2900, config: ["高阶辅助驾驶", "座椅通风加热", "15.6英寸中控"] },
      { id: "bc-s3-700", name: "700km 旗舰版", guidePrice: 22.58, rangeKm: 700, powerKw: 250, lengthMm: 4920, wheelbaseMm: 2900, config: ["激光雷达", "座椅按摩", "品牌音响"] }
    ]
  },
  {
    id: "cf-t5",
    brand: "长风",
    series: "拓界 T5",
    level: "中大型SUV",
    energyType: "燃油",
    seats: 7,
    bodyType: "SUV",
    launchYear: 2025,
    tags: ["七座", "大空间", "长途"],
    description: "七座燃油中大型 SUV，适合多孩家庭或经常全家出行的用户。",
    variants: [
      { id: "cf-t5-2w", name: "2.0T 两驱七座", guidePrice: 20.98, powerKw: 180, lengthMm: 4980, wheelbaseMm: 2950, fuelConsumption: 8.8, config: ["七座布局", "电动尾门", "全景影像"] },
      { id: "cf-t5-4w", name: "2.0T 四驱七座", guidePrice: 23.98, powerKw: 200, lengthMm: 4980, wheelbaseMm: 2950, fuelConsumption: 9.6, config: ["四驱系统", "座椅加热通风", "自适应巡航"] }
    ]
  },
  {
    id: "cf-t7",
    brand: "长风",
    series: "拓界 T7",
    level: "中大型SUV",
    energyType: "混动",
    seats: 6,
    bodyType: "SUV",
    launchYear: 2026,
    tags: ["六座", "舒适", "混动"],
    description: "六座混动中大型 SUV，二排独立座椅，兼顾油耗与舒适性。",
    variants: [
      { id: "cf-t7-h", name: "1.5T 混动六座", guidePrice: 24.98, rangeKm: 130, powerKw: 210, lengthMm: 5000, wheelbaseMm: 2980, fuelConsumption: 5.8, config: ["二排独立座椅", "纯电续航130km", "电动侧踏"] },
      { id: "cf-t7-h4", name: "1.5T 混动四驱六座", guidePrice: 27.98, rangeKm: 120, powerKw: 260, lengthMm: 5000, wheelbaseMm: 2980, fuelConsumption: 6.2, config: ["四驱系统", "座椅按摩", "品牌音响"] }
    ]
  },
  {
    id: "xh-m1",
    brand: "星海",
    series: "微光 M1",
    level: "微型车",
    energyType: "纯电",
    seats: 4,
    bodyType: "两厢车",
    launchYear: 2025,
    tags: ["代步", "便宜", "好停车"],
    description: "微型纯电代步车，车身小巧好停车，适合城市短途通勤与买菜接娃。",
    variants: [
      { id: "xh-m1-300", name: "300km 标准版", guidePrice: 6.98, rangeKm: 300, powerKw: 50, lengthMm: 3300, wheelbaseMm: 2150, config: ["倒车雷达", "空调", "手机互联"] },
      { id: "xh-m1-400", name: "400km 长续航版", guidePrice: 8.58, rangeKm: 400, powerKw: 60, lengthMm: 3300, wheelbaseMm: 2150, config: ["倒车影像", "快充", "蓝牙钥匙"] }
    ]
  },
  {
    id: "yt-x1",
    brand: "云途",
    series: "远山 X1",
    level: "小型SUV",
    energyType: "燃油",
    seats: 5,
    bodyType: "SUV",
    launchYear: 2024,
    tags: ["入门", "省油", "性价比"],
    description: "入门级小型燃油 SUV，价格亲民，适合预算有限的首次购车用户。",
    variants: [
      { id: "yt-x1-15", name: "1.5L 手动版", guidePrice: 9.98, powerKw: 88, lengthMm: 4300, wheelbaseMm: 2600, fuelConsumption: 6.2, config: ["倒车雷达", "手动空调", "织物座椅"] },
      { id: "yt-x1-15t", name: "1.5T 自动版", guidePrice: 11.58, powerKw: 110, lengthMm: 4300, wheelbaseMm: 2600, fuelConsumption: 6.5, config: ["倒车影像", "自动空调", "无钥匙启动"] }
    ]
  }
];

export function findModel(modelId: string) {
  return CARS.find((m) => m.id === modelId);
}

export function findVariant(modelId: string, variantId: string) {
  return findModel(modelId)?.variants.find((v) => v.id === variantId);
}
