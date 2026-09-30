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
      watchlistSurface: "#211E17",
      watchlistSection: "#29251D",
      watchlistBorder: "#3B3529",
      watchlistDivider: "#342F25",
      watchlistActive: "#26383A",
      watchlistIndicator: "#F1BD55",
      leaderboardSurface: "#211E18",
      leaderboardRow: "#29241C",
      leaderboardBorder: "#3A3429",
      leaderboardPosition: "#56B99D",
      leaderboardIncrease: "#F07859",
      leaderboardDecrease: "#65CFA7",
      leaderboardText: "#E8DDC6",
      leaderboardValue: "#FFE7B0",
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
      background: "#191916",
      grid: "#36352D",
      text: "#D3C7AD",
      border: "#514A3A",
      crosshair: "#D0AF62",
      candleUp: "#39C8A0",
      candleDown: "#F07155",
      candleBorderUp: "#7CE6C4",
      candleBorderDown: "#FFAA82",
      channel: "#47C4DE",
      channelMiddle: "#E0B957",
      swingPath: "#F48465",
      subchartUp: "#59BFEA",
      subchartDown: "#D98960",
      breakoutUp: "#63D5A9",
      breakoutDown: "#F07155",
      markerVolume: "#74C9F3",
      markerEntity: "#F2C85C",
      markerOiUp: "#54D5B1",
      markerOiDown: "#F09A65",
      sessionBackground: { night: "rgba(121, 76, 150, 0.20)", day: "rgba(34, 124, 137, 0.19)" },
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
