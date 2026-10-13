import type { Bundle, GameView, PactTerms } from "./model";
import { actionContent } from "./content";
export function pactPresentation(g: GameView, p: PactTerms) {
  const side = p.maker === g.seat ? 0 : 1,
    other = side === 0 ? p.taker : p.maker;
  const reserve = p.gives.map((b) => [...b] as Bundle) as [Bundle, Bundle];
  const providerSide = p.provider === p.maker ? 0 : 1;
  if (p.kind === 3) reserve[providerSide][2] += p.delivery;
  if (p.kind === 1) {
    const cost = actionContent(g.stage, p.action, 0, g.version).cost;
    for (let i = 0; i < 3; i++)
      reserve[providerSide][i] += Math.max(
        0,
        cost[i] - p.gives[1 - providerSide][i],
      );
  }
  return {
    side,
    other,
    mine: p.gives[side],
    theirs: p.gives[1 - side],
    reserve,
    mineReserved: reserve[side],
    theirReserved: reserve[1 - side],
    ownActionBound: p.kind !== 0 && p.provider === g.seat,
    output: p.kind === 2 ? (g.stage === 0 ? "water" : "cargo") : null,
    share: p.kind === 2 ? (g.stage === 0 ? "4" : "3–4") : null,
  };
}
