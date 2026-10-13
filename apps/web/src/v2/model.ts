/** Presentation boundary. Chain adapters must use canonical V2 state and receipts. */
import type { CommunityAccess } from './community';
export type Bundle = [number, number, number];
export type Move = { action: number; route: number; delivery: number };
export type PactTerms = {
  maker: number; taker: number; provider: number; kind: number;
  action: number; delivery: number; gives: [Bundle, Bundle]; nonce: number; stage: number;
};
export type Seat = {
  owner: string; name: string; npc: boolean; resources: Bundle; reserved: Bundle;
  support: number; delivered: number; forfeited: boolean; seal: boolean;
  bound: number | null; ready: boolean; sessionQuota?: number; offerNonce?: number;
};
export type Pact = PactTerms & { status: "open" | "accepted" | "cancelled" | "expired"; job?: number };
export type Receipt = {
  stage: number; route: number; hullBefore: number; hullAfter: number;
  threat: number; defense: number; actions: number[]; objective: boolean;
  outcome: string; resources: Bundle[]; delivered: number[]; support: number[];
  reasons: string[]; proof: "practice" | "confirmed" | "finalized";
  settlementKey?: string; flags?: number; progress?: number; goal?: number;
  missingMask?: number; forfeitedMask?: number; rejectedCodes?: number[];
  escortGoal?:number;escortProgress?:number;pledged?:number[];voluntary?:number[];
  pricesPaid?:Bundle[];pricesReceived?:Bundle[];
  inputs?: Bundle[]; outputs?: Bundle[]; deliveries?: number[]; pacts?: Pact[];
  work?: Array<{ provider: number; action: number; executed: boolean; consumed?: Bundle; delivered?: number; job?: number; owner?: string; nonce?: number }>;
};
export type VaultView = {
  active: boolean; funded: boolean; test: true; mint: string;
  issuer: "devnet" | "local-fixture"; amount: number;
  slots: Array<{ id: number; status: "open" | "reserved" | "earned" | "paid" | "refunded"; provider?: number; recipient?: string; refundable?: boolean; proof?: "confirmed" | "finalized" }>;
  refundable: boolean;
  sponsor?: string;
};
export type TxView = {
  stage: string; signature?: string; feeLamports?: bigint; error?: string;
  feePayer?:string;sponsored?:boolean;
};
export type GameView = {
  testFunding?: import('./test-funding').TestFunding;
  version: 2 | 3; match: string; network: "practice" | "local" | "devnet";
  stage: number; phase: number; hull: number; count: number; seat: number;
  seats: Seat[]; offers: Pact[]; history: Receipt[]; bridgeOpen: boolean;
  committed: number; revealed: number; seconds: number; revision: number;
  arrived: boolean; sessionActive: boolean; sessionPaused?: boolean; transaction?: TxView;
  automaticPlanApproved?:boolean;
  vault?: VaultView; configHash?: string; termsHash?: string;
  preparedChoice?: Move; preparedStatus?: "missing" | "verified" | "invalid";
  replay?: {valid:boolean;checkedStages:number;error?:string;scope:string};
  fees?:{enabled:boolean;payer?:string};
};
export type Operation = { ok: boolean; error?: string };
export interface GameController {
  readonly community?:CommunityAccess;
  snapshot(): GameView;
  subscribe(listener: () => void): () => void;
  readonly ownerAvailable: boolean;
  readonly recoveryAvailable: boolean;
  readonly canConfigureMission?: boolean;
  readonly canFundMission?: boolean;
  revisePlan?():Promise<Operation>;
  enableFeeSupport?():Promise<Operation>;
  disableFeeSupport?():Promise<Operation>;
  refresh(): Promise<Operation>;
  ready(): Promise<Operation>;
  start(): Promise<Operation>;
  offer(terms: PactTerms, bountySlot?: number): Promise<Operation>;
  accept(offer: Pact): Promise<Operation>;
  cancel(): Promise<Operation>;
  planReady(move: Move): Promise<Operation>;
  commit(move: Move): Promise<Operation>;
  reveal(): Promise<Operation>;
  advance(): Promise<Operation>;
  resolve(): Promise<Operation>;
  enableSession(): Promise<Operation>;
  revokeSession(): Promise<Operation>;
  exportMove(): string | null;
  exportRecovery?():Promise<string>;
  importMove(json: string): Promise<Operation>;
  fundMission(): Promise<Operation>;
  claim(slot: number): Promise<Operation>;
  refund(): Promise<Operation>;
  dispose(): void;
}
export const zero = (): Bundle => [0, 0, 0];
export function free(seat: Seat): Bundle {
  return seat.resources.map((amount, i) => Math.max(0, amount - seat.reserved[i])) as Bundle;
}
export function score(seat: Seat, arrived: boolean): number {
  return arrived && !seat.forfeited ? 3 * seat.resources[2] + seat.delivered + seat.support : 0;
}
/** A game revision also changes for offers and ready bits; it is not a settlement identity. */
export function receiptKey(match: string, receipt: Receipt): string {
  return `${match}:${receipt.settlementKey ?? `stage-${receipt.stage}`}`;
}
export function sameChoice(a: Move, b: Move): boolean {
  return a.action === b.action && a.route === b.route && a.delivery === b.delivery;
}
