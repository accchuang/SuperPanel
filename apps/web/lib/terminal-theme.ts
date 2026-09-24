export type TerminalTheme = "light" | "dark";

export const TERMINAL_THEME_KEY = "market-terminal.theme.v1";

export type TerminalChartPalette = {
  background: string;
  grid: string;
  text: string;
  border: string;
  crosshair: string;
  candleUp: string;
  candleDown: string;
  candleBorderUp: string;
  candleBorderDown: string;
  channel: string;
  channelMiddle: string;
  swingPath: string;
  subchartUp: string;
  subchartDown: string;
  breakoutUp: string;
  breakoutDown: string;
  markerVolume: string;
  markerEntity: string;
  markerOiUp: string;
  markerOiDown: string;
  sessionBackground: { night: string; day: string };
};

export type TerminalUiPalette = {
  watchlistSurface: string;
  watchlistSection: string;
  watchlistBorder: string;
  watchlistDivider: string;
  watchlistActive: string;
  watchlistIndicator: string;
  leaderboardSurface: string;
  leaderboardRow: string;
  leaderboardBorder: string;
  leaderboardPosition: string;
  leaderboardIncrease: string;
  leaderboardDecrease: string;
  leaderboardText: string;
  leaderboardValue: string;
};

export function resolveTerminalTheme(raw: string | null): TerminalTheme {
  return raw === "dark" ? "dark" : "light";
}

export function terminalUiPalette(theme: TerminalTheme): TerminalUiPalette {
  if (theme === "dark") {
    return {
      watchlistSurface: "#0D151D",
      watchlistSection: "#101B24",
      watchlistBorder: "#1D2C35",
      watchlistDivider: "#18252D",
      watchlistActive: "#14262D",
      watchlistIndicator: "#3F9289",
      leaderboardSurface: "#0F1820",
      leaderboardRow: "#111E27",
      leaderboardBorder: "#1B2A33",
      leaderboardPosition: "#356F65",
      leaderboardIncrease: "#B85F55",
      leaderboardDecrease: "#3C8D76",
      leaderboardText: "#D1DCE2",
      leaderboardValue: "#EDF3F6",
    };
  }

  return {
    watchlistSurface: "#FFFFFF",
    watchlistSection: "#F8FAFB",
    watchlistBorder: "#E1E8EC",
    watchlistDivider: "#E8ECEF",
    watchlistActive: "#E8EFF2",
    watchlistIndicator: "#6F929A",
    leaderboardSurface: "#FFFFFF",
    leaderboardRow: "#FBFCFD",
    leaderboardBorder: "#E7ECEF",
    leaderboardPosition: "#76BFA1",
    leaderboardIncrease: "#D94727",
    leaderboardDecrease: "#35A04C",
    leaderboardText: "#53616C",
    leaderboardValue: "#537565",
  };
}

export function terminalChartPalette(theme: TerminalTheme): TerminalChartPalette {
  if (theme === "dark") {
    return {
      background: "#0D141C",
      grid: "#1D2A36",
      text: "#9AABB7",
      border: "#2B3A47",
      crosshair: "#708896",
      candleUp: "#26A69A",
      candleDown: "#EF5350",
      candleBorderUp: "#26A69A",
      candleBorderDown: "#EF5350",
      channel: "#77B6BD",
      channelMiddle: "#6F838E",
      swingPath: "#FF5360",
      subchartUp: "#72B4C0",
      subchartDown: "#B39179",
      breakoutUp: "#26A69A",
      breakoutDown: "#EF5350",
      markerVolume: "#7FC6DB",
      markerEntity: "#D8A75E",
      markerOiUp: "#7FC6DB",
      markerOiDown: "#C99A78",
      sessionBackground: { night: "rgba(171, 102, 61, 0.16)", day: "rgba(57, 125, 151, 0.16)" },
    };
  }

  return {
    background: "#FFFFFF",
    grid: "#EDF0F2",
    text: "#687582",
    border: "#D8E0E6",
    crosshair: "#95A0AA",
    candleUp: "#E8EFF2",
    candleDown: "#87949B",
    candleBorderUp: "#6E8794",
    candleBorderDown: "#74818A",
    channel: "#6F929A",
    channelMiddle: "#ADB8BE",
    swingPath: "#E83B45",
    subchartUp: "#78929E",
    subchartDown: "#B5AEA3",
    breakoutUp: "#4F7180",
    breakoutDown: "#4F5A61",
    markerVolume: "#365F72",
    markerEntity: "#916526",
    markerOiUp: "#365F72",
    markerOiDown: "#805A3D",
    sessionBackground: { night: "rgba(255, 220, 195, 0.25)", day: "rgba(195, 235, 255, 0.25)" },
  };
}
