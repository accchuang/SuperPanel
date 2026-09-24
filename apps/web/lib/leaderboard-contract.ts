export function leaderboardContractCode(contract: string): string | null {
  const code = contract.trim().toUpperCase();
  return /^[A-Z]+\d{3,6}$/.test(code) ? code : null;
}
