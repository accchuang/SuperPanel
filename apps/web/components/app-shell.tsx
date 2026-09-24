"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, CandlestickChart, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LayoutGrid, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

const modules = [
  { href: "/market-terminal", label: "行情终端", icon: CandlestickChart },
  { href: "/market-panorama", label: "市场全景", icon: LayoutGrid },
];

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isMarketTerminal = pathname === "/market-terminal" || pathname === "/market-panorama";
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={`app-shell ${isMarketTerminal ? "app-shell-terminal flex h-dvh min-h-0 flex-col overflow-hidden md:flex-row" : "min-h-screen md:flex"}`}>
      <aside className={`w-full border-b transition-[width] duration-200 md:sticky md:top-0 md:h-screen md:shrink-0 md:border-b-0 md:border-r ${isMarketTerminal ? "border-[#E2E7EC] bg-white text-[#344054]" : "border-border bg-[#111114]"} ${collapsed ? "md:w-[72px]" : "md:w-60"}`}>
        <div className={`flex h-full flex-col py-2 md:py-6 ${collapsed ? "px-2" : "px-3 md:px-4"}`}>
          <div className={`flex items-center px-2 text-sm font-semibold ${collapsed ? "justify-between gap-1 md:justify-between" : "justify-between gap-2"}`}>
            <div className="flex items-center gap-2">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-sm ${isMarketTerminal ? "bg-[#E8EFF2] text-[#455E6B]" : "bg-primary text-black"}`}><BarChart3 size={15} /></span>
              <span className={collapsed ? "hidden" : ""}>Futures Intelligence</span>
            </div>
            <button
              type="button"
              aria-label={collapsed ? "展开全局菜单" : "折叠全局菜单"}
              aria-expanded={!collapsed}
              title={collapsed ? "展开全局菜单" : "折叠全局菜单"}
              onClick={() => setCollapsed(value => !value)}
              className={`grid h-7 w-7 shrink-0 place-items-center rounded md:h-6 md:w-6 ${isMarketTerminal ? "text-[#74808A] hover:bg-[#F0F2F4] hover:text-[#344054]" : "text-muted-foreground hover:bg-white/10 hover:text-foreground"}`}
            >
              {collapsed ? <><ChevronDown className="md:hidden" size={15} /><ChevronRight className="hidden md:block" size={15} /></> : <><ChevronUp className="md:hidden" size={15} /><ChevronLeft className="hidden md:block" size={15} /></>}
            </button>
          </div>
          <div className={`mt-6 hidden items-center gap-2 px-2 text-[11px] font-medium md:flex ${isMarketTerminal ? "text-[#89949D]" : "text-muted-foreground"} ${collapsed ? "md:justify-center" : ""}`}><Settings2 size={13} /><span className={collapsed ? "md:hidden" : ""}>全局管理</span></div>
          <nav aria-label="全局模块" className={`${collapsed ? "hidden md:flex" : "flex"} mt-1 gap-1 overflow-x-auto md:mt-2 md:flex-col md:overflow-visible`}>
            {modules.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(
                "flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors md:px-2",
                collapsed ? "md:justify-center" : "",
                isMarketTerminal
                  ? active ? "bg-[#E8EFF2] text-[#344F5A]" : "text-[#6E7A85] hover:bg-[#F1F3F5] hover:text-[#344054]"
                  : active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )} title={collapsed ? label : undefined}><Icon size={16} /><span className={collapsed ? "hidden" : ""}>{label}</span></Link>;
            })}
          </nav>
          <div className={`mt-auto hidden border-t pt-4 text-[11px] md:block ${isMarketTerminal ? "border-[#E2E7EC] text-[#909AA2]" : "border-border text-muted-foreground"} ${collapsed ? "text-center" : ""}`}>{collapsed ? "LRT" : "LOCAL RESEARCH TERMINAL"}</div>
        </div>
      </aside>
      <div className={`min-w-0 flex-1 ${isMarketTerminal ? "min-h-0" : ""}`}>{children}</div>
    </div>
  );
}
