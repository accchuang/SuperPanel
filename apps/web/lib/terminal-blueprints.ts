export const TERMINAL_BLUEPRINTS_KEY = "superpanel.market-terminal.blueprints.v1";

export type TerminalBlueprint = {
  direction: "LONG" | "SHORT" | "WATCH";
  trigger: string;
  invalidation: string;
};

export const EMPTY_BLUEPRINT: TerminalBlueprint = { direction: "WATCH", trigger: "", invalidation: "" };

export function resolveTerminalBlueprints(saved: string | null, contracts: readonly string[]): Record<string, TerminalBlueprint> {
  if (!saved) return {};
  try {
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, TerminalBlueprint> = {};
    for (const contract of contracts) {
      const item = (parsed as Record<string, unknown>)[contract];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (row.direction !== "LONG" && row.direction !== "SHORT" && row.direction !== "WATCH") continue;
      if (typeof row.trigger !== "string" || typeof row.invalidation !== "string") continue;
      result[contract] = {
        direction: row.direction,
        trigger: row.trigger.slice(0, 200),
        invalidation: row.invalidation.slice(0, 200),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function updateTerminalBlueprint(
  current: Record<string, TerminalBlueprint>, contract: string, blueprint: TerminalBlueprint,
): Record<string, TerminalBlueprint> {
  return { ...current, [contract]: blueprint };
}
