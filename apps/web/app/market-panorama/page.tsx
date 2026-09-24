"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type PanoramaQuote, type PanoramaQuotes } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

const SECTOR_ORDER = ["贵金属", "有色", "黑色工业", "能源", "化工", "建材轻工", "油脂油料", "农产品", "橡胶", "航运", "其他"];
const UP = "#557887";
const DOWN = "#9A8C80";
const FLAT = "#84919A";

type SectorView = {
  name: string;
  quotes: PanoramaQuote[];
  fiveDayMedian: number | null;
  rising: number;
  measured: number;
  priceLine: number[];
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sectorViews(quotes: PanoramaQuote[]): SectorView[] {
  const grouped = new Map<string, PanoramaQuote[]>();
  for (const quote of quotes) grouped.set(quote.sector, [...(grouped.get(quote.sector) ?? []), quote]);
  return [...grouped.entries()].map(([name, items]) => {
    const changes = items.map((item) => item.five_day_change_percent).filter((value): value is number => value != null);
    const histories = items.map((item) => item.price_history).filter((history) => history.length === 6 && history[0] > 0);
    const priceLine = histories.length ? Array.from({ length: 6 }, (_, index) =>
      median(histories.map((history) => (history[index] / history[0] - 1) * 100)) ?? 0
    ) : [];
    return {
      name,
      quotes: [...items].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      fiveDayMedian: median(changes),
      rising: changes.filter((value) => value > 0).length,
      measured: changes.length,
      priceLine,
    };
  }).sort((a, b) => {
    const aIndex = SECTOR_ORDER.indexOf(a.name);
    const bIndex = SECTOR_ORDER.indexOf(b.name);
    return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex) || a.name.localeCompare(b.name, "zh-CN");
  });
}

function priceColor(change: number | null) {
  if (change == null) return FLAT;
  return change > 0.3 ? UP : change < -0.3 ? DOWN : FLAT;
}

function changeText(change: number | null) {
  return change == null ? "--" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function PriceLine({ values, color, width = 86 }: { values: number[]; color: string; width?: number }) {
  if (values.length < 2) return <span className="inline-block text-[10px] text-[#B0B8BD]">—</span>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, Math.abs(high) * 0.01, 0.01);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * (width - 4) + 2},${22 - ((value - low) / range) * 16}`).join(" ");
  return <svg aria-hidden="true" width={width} height="26" viewBox={`0 0 ${width} 26`} className="shrink-0"><polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function SectorCard({ sector, active, onClick }: { sector: SectorView; active: boolean; onClick: () => void }) {
  const color = priceColor(sector.fiveDayMedian);
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-w-0 rounded border bg-white px-3 py-2.5 text-left transition-colors hover:bg-[#F9FBFC] ${active ? "border-[#7E9AA5] shadow-[0_0_0_1px_#B8CCD3]" : "border-[#DFE6EA]"}`}>
    <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-[#35444F]">{sector.name}</span><span className="shrink-0 font-mono text-[10px] text-[#97A3AA]">{sector.quotes.length}</span></div>
    <div className="mt-1 flex items-end justify-between gap-1"><span className="font-mono text-lg font-semibold leading-none" style={{ color }}>{changeText(sector.fiveDayMedian)}</span><PriceLine values={sector.priceLine} color={color} width={62} /></div>
    <div className="mt-1 text-[10px] text-[#8A969E]">{sector.measured ? `上涨 ${sector.rising} / ${sector.measured}` : "价格样本不足"}</div>
  </button>;
}

function ContractRow({ quote }: { quote: PanoramaQuote }) {
  const color = priceColor(quote.five_day_change_percent);
  return <div className="grid grid-cols-[minmax(0,1fr)_76px_66px_60px] items-center gap-1 border-t border-[#EEF1F3] px-3 py-1.5" title={`${quote.contract} · ${quote.quote_time ?? "无报价时间"} · ${quote.price_source === "QUOTE" ? "TqSdk报价" : "K线收盘价回退"}`}>
    <div className="min-w-0 truncate"><span className="text-[11px] font-medium text-[#41515C]">{quote.name}</span><span className="ml-1.5 font-mono text-[9px] text-[#9AA5AC]">{quote.contract}</span></div>
    <span className="text-right font-mono text-[11px] text-[#45535D]">{quote.last_price == null ? "--" : formatNumber(quote.last_price)}</span>
    <span className="text-right font-mono text-[10px]" style={{ color }}>{changeText(quote.five_day_change_percent)}</span>
    <PriceLine values={quote.price_history} color={color} width={58} />
  </div>;
}

export default function MarketPanoramaPage() {
  const [snapshot, setSnapshot] = useState<PanoramaQuotes | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setSnapshot(await api.marketPanorama());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "全市场价格暂不可用");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const currentQuotes = useMemo(() => {
    const quotes = snapshot?.quotes ?? [];
    const latestTradingDay = quotes.reduce((latest, quote) => quote.trading_day && quote.trading_day > latest ? quote.trading_day : latest, "");
    return quotes.filter((quote) => quote.trading_day === latestTradingDay && quote.last_price != null);
  }, [snapshot]);
  const sectors = useMemo(() => sectorViews(currentQuotes), [currentQuotes]);
  const visibleSectors = selectedSector ? sectors.filter((sector) => sector.name === selectedSector) : sectors;
  const measured = sectors.reduce((total, sector) => total + sector.measured, 0);
  const rising = sectors.reduce((total, sector) => total + sector.rising, 0);
  const snapshotTime = snapshot?.fetched_at ? new Date(snapshot.fetched_at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "--";

  return <main className="h-full min-h-0 overflow-y-auto bg-[#F6F8F9] px-4 pb-6 text-[#2F3D47] md:px-6">
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-[#DFE6EA] bg-[#F6F8F9]/95 py-3 backdrop-blur-sm">
      <div><h1 className="text-lg font-semibold leading-6">市场全景</h1><p className="text-[11px] text-[#8A969F]">国内商品主力 · 仅看价格</p></div>
      <div className="flex items-center gap-2 text-[10px] text-[#7E8C96]">
        <span className={`rounded border px-2 py-1 ${snapshot?.data_mode === "LIVE" ? "border-[#D5E3E5] bg-[#EEF4F5] text-[#587984]" : "border-[#E6E0D7] bg-[#F5F2ED] text-[#8D806F]"}`}>{snapshot?.data_mode === "LIVE" ? "实时" : snapshot?.data_mode === "STATIC" ? "静态快照" : "等待行情"}</span>
        <span className="font-mono">{snapshotTime}</span>
        <button type="button" aria-label="刷新市场全景" title="刷新" onClick={() => void load(true)} disabled={refreshing} className="grid h-7 w-7 place-items-center rounded border border-[#D7E0E5] bg-white text-[#74828C] hover:bg-[#EEF3F5] disabled:opacity-50"><RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /></button>
      </div>
    </header>

    {error && <div role="alert" className="mt-3 rounded border border-[#E6D8D5] bg-[#FAF6F5] px-3 py-2 text-xs text-[#9B716D]">{error}</div>}
    {snapshot?.connection_error && <div role="status" className="mt-3 rounded border border-[#E6E0D7] bg-[#F8F5F0] px-3 py-2 text-xs text-[#8D806F]">{snapshot.connection_error}</div>}

    <section className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">板块走势</h2><span className="text-[10px] text-[#8A969F]">近5个交易日 · 各合约价格涨跌幅的中位数</span></div>
      {loading && !snapshot ? <div className="rounded border border-[#DFE6EA] bg-white p-8 text-center text-xs text-[#8A969F]">正在读取全市场价格…</div> : sectors.length ?
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{sectors.map((sector) => <SectorCard key={sector.name} sector={sector} active={selectedSector === sector.name} onClick={() => setSelectedSector((current) => current === sector.name ? null : sector.name)} />)}</div>
        : <div className="rounded border border-[#DFE6EA] bg-white p-8 text-center text-xs text-[#8A969F]">全市场价格快照正在建立</div>}
    </section>

    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><div className="flex items-baseline gap-2"><h2 className="text-sm font-semibold">{selectedSector ?? "全部合约"}</h2>{selectedSector && <button type="button" onClick={() => setSelectedSector(null)} className="text-[10px] text-[#63818D] hover:underline">查看全部</button>}</div><span className="text-[10px] text-[#8A969F]">本交易日 {currentQuotes.length} / {snapshot?.universe_size ?? 0} 个品种 · {measured} 个有5日样本 · 上涨 {rising}</span></div>
      <div className="grid items-start gap-3 xl:grid-cols-2">{visibleSectors.map((sector) => <section key={sector.name} className={`min-w-0 overflow-hidden rounded border border-[#DFE6EA] bg-white ${selectedSector ? "xl:col-span-2 xl:grid xl:grid-cols-2" : ""}`}>
        <div className={`flex items-center justify-between gap-2 bg-[#FBFCFD] px-3 py-2 ${selectedSector ? "xl:col-span-2" : ""}`}><h3 className="text-[11px] font-semibold text-[#4D5D68]">{sector.name} <span className="ml-1 font-mono font-normal text-[#A1ABB1]">{sector.quotes.length}</span></h3><span className="font-mono text-[10px]" style={{ color: priceColor(sector.fiveDayMedian) }}>{changeText(sector.fiveDayMedian)}</span></div>
        {sector.quotes.map((quote) => <ContractRow key={quote.contract} quote={quote} />)}
      </section>)}</div>
    </section>
    <footer className="mt-4 text-[10px] leading-5 text-[#9AA6AD]">价格来自 TqSdk 具体主力合约；仅统计最近交易日有报价的品种。5日走势使用已完成日线和当前报价；板块数值是合约涨跌幅中位数，不代表板块指数。休市时展示最后快照。</footer>
  </main>;
}
