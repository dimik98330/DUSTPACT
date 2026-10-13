import type { Bundle, GameView, PactTerms } from "./model";
import { actionContent } from "./content";

export function projectRecipe(game: GameView): Bundle {
  return actionContent(game.stage, game.stage === 0 ? 3 : 4, 0, game.version)
    .cost;
}
/** Editing a project reallocates its existing recipe; it never creates extra inputs. */
export function editContribution(
  terms: PactTerms,
  side: number,
  resource: number,
  amount: number,
  recipe: Bundle,
): PactTerms {
  const gives = terms.gives.map((b) => [...b] as Bundle) as [Bundle, Bundle];
  gives[side][resource] = amount;
  if (terms.kind === 2)
    gives[1 - side][resource] =
      Number.isInteger(amount) && amount >= 0 && amount <= recipe[resource]
        ? recipe[resource] - amount
        : NaN;
  return { ...terms, gives };
}
export function paidJobAvailable(
  game: GameView,
  terms: PactTerms,
  slot: number | undefined,
): boolean {
  return (
    slot === undefined ||
    !!(
      game.stage === 1 &&
      terms.kind === 1 &&
      terms.action === 3 &&
      game.vault?.funded &&
      game.vault.active &&
      !game.seats[terms.provider].npc &&
      game.vault.slots.some((s) => s.id === slot && s.status === "open")
    )
  );
}
