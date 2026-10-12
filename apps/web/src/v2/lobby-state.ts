type LobbyRoster = {
  count: number;
  seat: number;
  seats: Array<{ ready: boolean; npc: boolean }>;
};
/** A full lobby never replaces NPCs with newly invited players. */
export function canInvitePlayer(g: { phase: number; count: number }) {
  return g.phase === 0 && g.count >= 1 && g.count < 6;
}
/** Presentation only. A button never signs readiness and starts in the same operation. */
export function lobbyState(g: LobbyRoster) {
  const complete =
    g.count >= 1 &&
    g.count <= 6 &&
    g.seats.length === g.count &&
    g.seat >= 0 &&
    g.seat < g.count;
  const readyCount = g.seats.filter((s) => s.ready).length,
    missing = Math.max(0, 4 - g.count),
    allReady = complete && g.count >= 4 && readyCount === g.count;
  const humans = g.seats.filter((s) => !s.npc).length,
    soloWithAgents = humans === 1 && g.seats.some((s) => s.npc);
  const action = !complete
    ? "sync"
    : missing
      ? "invite"
      : !g.seats[g.seat].ready
        ? "ready"
        : allReady && g.seat === 0
          ? "start"
          : allReady
            ? "wait-host"
            : "wait-ready";
  return {
    action,
    readyCount,
    missing,
    allReady,
    soloWithAgents,
    target: Math.max(4, g.count),
  } as const;
}
