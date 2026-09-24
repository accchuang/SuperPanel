export function leaderboardContractCode(contract: string): string | null {
  const code = contract.trim().toUpperCase();
  return /^[A-Z]+\d{3,6}$/.test(code) ? code : null;
}

export function leaderboardLookupSymbols(contract: string): string[] {
  const code = leaderboardContractCode(contract);
  if (!code) return [];
  const variety = code.match(/^[A-Z]+/)?.[0];
  return variety ? [code, variety] : [code];
}
