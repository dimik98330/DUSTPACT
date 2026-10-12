import { SYSTEM, type GameV3 } from "../../../../packages/solana-v3/src/index";
import type { Address } from "@solana/kit";
type Host = {
  signer: { address: Address };
  read(match: Address): Promise<GameV3>;
  configureMission(
    match: Address,
    mask: number,
    enabled: boolean,
  ): Promise<unknown>;
};
type Bot = {
  signer: { address: Address };
  fundLocal(): Promise<unknown>;
  join(match: Address): Promise<unknown>;
};
/** Resume only the creator's own unstarted, unpaid agent roster. Never replace occupied seats. */
export async function completeAgentRoster<T extends Bot>(
  host: Host,
  match: Address,
  count: number,
  botAt: (seat: number) => Promise<T>,
  progress?: (seat: number, total: number) => void,
): Promise<T[]> {
  if (!Number.isInteger(count) || count < 4 || count > 6)
    throw Error("Invalid companion roster");
  let g = await host.read(match);
  if (
    g.creator !== host.signer.address ||
    g.phase !== 0 ||
    g.count > count ||
    g.mission !== SYSTEM ||
    g.eligibleMask !== 0
  )
    throw Error(
      "Состав или оплаченная миссия изменились. Открой сохранённый матч. / Roster or paid mission changed. Open the retained match.",
    );
  const bots: T[] = [];
  for (let seat = 1; seat < count; seat++) {
    const bot = await botAt(seat);
    g = await host.read(match);
    if (
      g.phase !== 0 ||
      g.creator !== host.signer.address ||
      g.mission !== SYSTEM ||
      g.eligibleMask !== 0 ||
      g.count > count
    )
      throw Error("Lobby changed while preparing companions");
    if (seat < g.count) {
      if (g.seats[seat].owner !== bot.signer.address)
        throw Error(
          "Место уже принадлежит другому игроку. Чужое место не заменено. / A different player owns this seat; it was not replaced.",
        );
    } else {
      if (seat !== g.count)
        throw Error("Roster changed during companion preparation");
      progress?.(seat, count - 1);
      await bot.fundLocal();
      await bot.join(match);
    }
    bots.push(bot);
  }
  g = await host.read(match);
  const mask = ((1 << count) - 1) ^ 1;
  if (g.count !== count || g.mission !== SYSTEM || g.eligibleMask !== 0)
    throw Error(
      "Lobby configuration changed; no replacement configuration signed",
    );
  if (g.npcMask !== mask || g.missionRoster !== g.roster)
    await host.configureMission(match, mask, false);
  return bots;
}
