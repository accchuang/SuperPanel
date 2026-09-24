export const symbolNames: Record<string, string> = {
  A: "豆一",
  AG: "白银",
  AL: "沪铝",
  AO: "氧化铝",
  AP: "苹果",
  AU: "黄金",
  C: "玉米",
  CF: "棉花",
  CS: "玉米淀粉",
  CU: "沪铜",
  HC: "热轧卷板",
  I: "铁矿石",
  J: "焦炭",
  JD: "鸡蛋",
  JM: "焦煤",
  M: "豆粕",
  NI: "沪镍",
  OI: "菜籽油",
  P: "棕榈油",
  PB: "沪铅",
  PK: "花生",
  RB: "螺纹钢",
  RM: "菜籽粕",
  SF: "硅铁",
  SM: "锰硅",
  SN: "沪锡",
  SR: "白糖",
  Y: "豆油",
  ZN: "沪锌",
};

export function formatSymbolLabel(symbol: string) {
  const name = symbolNames[symbol];
  return name ? `${symbol} ${name}` : symbol;
}
