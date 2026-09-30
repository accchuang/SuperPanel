"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { PriceAlert, PriceAlertDirection } from "@/lib/price-alerts";
import { formatNumber } from "@/lib/utils";

export function PriceAlertsMenu({
  contract,
  lastPrice,
  alerts,
  horizontalPrices,
  onAdd,
  onToggle,
  onRemove,
}: {
  contract: string;
  lastPrice: number | null;
  alerts: PriceAlert[];
  horizontalPrices: number[];
  onAdd: (price: number, direction: PriceAlertDirection) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [priceText, setPriceText] = useState("");
  const [direction, setDirection] = useState<PriceAlertDirection>("above");
  const [error, setError] = useState("");
  const [desktopPermission, setDesktopPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    setDesktopPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const add = (event: FormEvent) => {
    event.preventDefault();
    const price = Number(priceText);
    if (!Number.isFinite(price) || price <= 0 || !priceText.trim()) {
      setError("请输入有效的目标价");
      return;
    }
    onAdd(price, direction);
    setPriceText("");
    setError("");
  };

  const armedCount = alerts.filter((alert) => alert.armed).length;
  return <details className="relative z-30 text-[10px]">
    <summary aria-label="管理价格预警" className="cursor-pointer list-none rounded px-1 py-0.5 text-[#78848E] hover:bg-[#F0F3F4]">
      预警{armedCount ? ` ${armedCount}` : ""} ▾
    </summary>
    <div className="absolute right-0 top-[calc(100%+5px)] w-64 rounded border border-[#D8E0E4] bg-white p-2.5 text-[#52636D] shadow-lg">
      <div className="flex items-center justify-between"><span className="font-semibold text-[#344F5A]">{contract} 价格预警</span><span>现价 {lastPrice == null ? "--" : formatNumber(lastPrice)}</span></div>
      <form onSubmit={add} className="mt-2 flex items-center gap-1">
        <input aria-label="预警目标价" type="number" min="0" step="any" inputMode="decimal" value={priceText} onChange={(event) => setPriceText(event.target.value)} placeholder="目标价" className="min-w-0 flex-1 rounded border border-[#D7DFE3] px-1.5 py-1 font-mono outline-none focus:border-[#7899A3]" />
        <select aria-label="预警方向" value={direction} onChange={(event) => setDirection(event.target.value as PriceAlertDirection)} className="rounded border border-[#D7DFE3] bg-white px-1 py-1"><option value="above">上穿</option><option value="below">下穿</option></select>
        <button type="submit" className="rounded bg-[#607F8A] px-2 py-1 text-white hover:bg-[#506D77]">添加</button>
      </form>
      {error && <p role="alert" className="mt-1 text-[#AC654B]">{error}</p>}
      {horizontalPrices.length > 0 && <div className="mt-2 border-t border-[#E7ECEF] pt-1.5">
        <div className="mb-1 text-[#83919A]">从水平线取价</div>
        <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
          {[...new Set(horizontalPrices)].map((price) => <button key={price} type="button" onClick={() => { setPriceText(String(price)); setDirection(lastPrice != null && price < lastPrice ? "below" : "above"); setError(""); }} className="rounded border border-[#DBE3E6] px-1.5 py-0.5 font-mono hover:bg-[#F0F4F5]">{formatNumber(price)}</button>)}
        </div>
      </div>}
      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-[#E7ECEF] pt-1.5">
        {alerts.length ? alerts.map((alert) => <div key={alert.id} className="flex items-center gap-1 rounded bg-[#F7F9FA] px-1.5 py-1">
          <span className="min-w-0 flex-1 font-mono">{alert.direction === "above" ? "↑" : "↓"} {formatNumber(alert.price)}</span>
          <span className={alert.armed ? "text-[#4C7C75]" : "text-[#A4835C]"}>{alert.armed ? "监测中" : alert.triggeredAt ? "已触发" : "已暂停"}</span>
          <button type="button" aria-label={`${alert.armed ? "暂停" : "重新启用"}预警 ${formatNumber(alert.price)}`} onClick={() => onToggle(alert.id)} className="rounded px-1 hover:bg-[#E8EFF1]">{alert.armed ? "暂停" : "启用"}</button>
          <button type="button" aria-label={`删除预警 ${formatNumber(alert.price)}`} onClick={() => onRemove(alert.id)} className="rounded px-1 text-[#9A7571] hover:bg-[#F4E9E7]">×</button>
        </div>) : <p className="py-1 text-center text-[#98A3AA]">暂无预警</p>}
      </div>
      {desktopPermission === "default" && <button type="button" onClick={async () => setDesktopPermission(await Notification.requestPermission())} className="mt-2 text-[#537F8E] underline">开启桌面通知</button>}
      {desktopPermission === "granted" && <p className="mt-2 text-[#6B8B82]">桌面通知已开启</p>}
      <p className="mt-1 text-[9px] leading-4 text-[#98A3AA]">页面打开时监测最新价；穿越后提示一次，可重新启用。</p>
    </div>
  </details>;
}
