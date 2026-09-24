export function netPositionBarValues(netPosition: number, netChange: number) {
  return {
    position: Math.abs(netPosition),
    change: netPosition < 0 ? -netChange : netChange,
  };
}
