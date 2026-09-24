export type BrokerCategory = "foreign" | "institution" | "industry" | "retail";

type BrokerTag = {
  label: "外资" | "机构" | "产业" | "散户";
  className: string;
};

const FOREIGN_BROKERS = new Set([
  "乾坤期货",
  "高盛期货",
  "摩根大通",
  "摩根大通期货",
  "瑞银期货",
  "瑞银",
]);

const INDUSTRY_BROKERS = new Set([
  "中粮期货",
  "国贸期货",
]);

const INSTITUTION_BROKERS = new Set([
  "中信期货",
  "国泰君安",
  "国泰君安期货",
  "永安期货",
  "东证期货",
]);

const RETAIL_BROKERS = new Set([
  "东方财富",
  "东方财富期货",
  "徽商期货",
  "平安期货",
]);

export function brokerTag(broker: string): BrokerTag | null {
  if (FOREIGN_BROKERS.has(broker)) {
    return { label: "外资", className: "border-cyan-400/45 bg-cyan-400/10 text-cyan-300" };
  }
  if (INDUSTRY_BROKERS.has(broker)) {
    return { label: "产业", className: "border-amber-400/45 bg-amber-400/10 text-amber-300" };
  }
  if (INSTITUTION_BROKERS.has(broker)) {
    return { label: "机构", className: "border-sky-400/45 bg-sky-400/10 text-sky-300" };
  }
  if (RETAIL_BROKERS.has(broker)) {
    return { label: "散户", className: "border-fuchsia-400/45 bg-fuchsia-400/10 text-fuchsia-300" };
  }
  return null;
}
