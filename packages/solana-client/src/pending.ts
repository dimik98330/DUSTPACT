import { getBase58Encoder, type Address, type Signature } from '@solana/kit';

export const DIRECT_PENDING_LIMIT = 128;
const MAX_JSON_LENGTH = 128 * 1024;
const MAX_U64 = (1n << 64n) - 1n;
const PREFIX = 'dustpact:direct-pending:v1:';
const base58 = getBase58Encoder();
export type DirectPendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type DirectPendingErrorCode = 'storage_unavailable' | 'malformed_journal' | 'scope_mismatch' | 'invalid_record' | 'pending_conflict' | 'journal_full' | 'invalid_reconciliation';
export class DirectPendingJournalError extends Error {
  constructor(readonly code: DirectPendingErrorCode, message: string) {
    super(message); this.name = 'DirectPendingJournalError';
  }
}
type PublicMetadata = Readonly<{
  program: Address; genesis: string; actor: Address; match: Address; signature: Signature;
  intentHash: string; lastValidBlockHeight: bigint; feeLamports: bigint; createdAt: number;
}>;
export type DirectPendingInput = PublicMetadata & Readonly<{ status?: 'pending' }>;
export type DirectPendingRecord = PublicMetadata & (
  | Readonly<{ status: 'pending'; confirmedSlot?: never; rejectedReason?: never; rejectedSlot?: never }>
  | Readonly<{ status: 'confirmed'; confirmedSlot: bigint; rejectedReason?: never; rejectedSlot?: never }>
  | Readonly<{ status: 'rejected'; confirmedSlot?: never; rejectedReason: 'preflight' | 'program_error'; rejectedSlot?: bigint }>
);
export type DirectPendingRejection = Readonly<{ reason: 'preflight' | 'program_error'; slot?: bigint }>;
export type DirectPendingResolution =
  | Readonly<{ status: 'finalized' }>
  | Readonly<{ status: 'expired'; blockHeight: bigint }>;
export interface DirectPendingJournalOptions {
  program: Address; genesis: string; actor: Address; storage?: DirectPendingStorage;
}
type Scope = Readonly<{ program: Address; genesis: string; actor: Address }>;
const commonKeys = ['program', 'genesis', 'actor', 'match', 'signature', 'intentHash', 'lastValidBlockHeight', 'feeLamports', 'createdAt'] as const;
const nodeMemory = new Map<string, string>();
const nodeStorage: DirectPendingStorage = {
  getItem: key => nodeMemory.get(key) ?? null,
  setItem: (key, value) => { nodeMemory.set(key, value); },
  removeItem: key => { nodeMemory.delete(key); },
};
function fail(code: DirectPendingErrorCode, message: string): never { throw new DirectPendingJournalError(code, message); }
function shape(value: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_record', 'Invalid public pending metadata');
  const object = value as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(object).length || Object.getOwnPropertyNames(object).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(object, key))) fail('invalid_record', 'Unexpected or missing pending metadata field');
  return object;
}
function key(value: unknown, bytes = 32): string {
  if (typeof value !== 'string' || value.length < bytes || value.length > (bytes === 32 ? 44 : 88) || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) fail('invalid_record', 'Invalid base58 public metadata');
  try { if (base58.encode(value).length !== bytes) fail('invalid_record', 'Invalid base58 byte length'); }
  catch { fail('invalid_record', 'Invalid base58 public metadata'); }
  return value;
}
function u64(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_U64) fail('invalid_record', 'Pending integer is outside u64 bounds');
  return value;
}
function restoredU64(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) fail('invalid_record', 'Stored pending integer must be a canonical decimal string');
  return u64(BigInt(value));
}
function publicMetadata(value: Record<string, unknown>, scope: Scope, restored: boolean): PublicMetadata {
  const program = key(value.program) as Address, genesis = key(value.genesis), actor = key(value.actor) as Address;
  if (program !== scope.program || genesis !== scope.genesis || actor !== scope.actor) fail('scope_mismatch', 'Pending metadata belongs to a different program, network or actor');
  if (typeof value.intentHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.intentHash)) fail('invalid_record', 'intentHash must be 64 lowercase hexadecimal SHA-256 characters');
  if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) fail('invalid_record', 'Invalid pending creation timestamp');
  const integer = restored ? restoredU64 : u64;
  return Object.freeze({ program, genesis, actor, match: key(value.match) as Address, signature: key(value.signature, 64) as Signature,
    intentHash: value.intentHash, lastValidBlockHeight: integer(value.lastValidBlockHeight), feeLamports: integer(value.feeLamports), createdAt: value.createdAt });
}
function input(value: DirectPendingInput, scope: Scope): DirectPendingRecord {
  const object = shape(value, [...commonKeys, 'status'], commonKeys);
  if (object.status !== undefined && object.status !== 'pending') fail('invalid_record', 'New submissions enter the journal as pending');
  return Object.freeze({ ...publicMetadata(object, scope, false), status: 'pending' });
}
function restored(value: unknown, scope: Scope): DirectPendingRecord {
  const object = shape(value, [...commonKeys, 'status', 'confirmedSlot', 'rejectedReason', 'rejectedSlot'], [...commonKeys, 'status']);
  const common = publicMetadata(object, scope, true);
  const rejectedFields = Object.hasOwn(object, 'rejectedReason') || Object.hasOwn(object, 'rejectedSlot');
  if (object.status === 'pending' && !Object.hasOwn(object, 'confirmedSlot') && !rejectedFields) return Object.freeze({ ...common, status: 'pending' });
  if (object.status === 'confirmed' && Object.hasOwn(object, 'confirmedSlot') && !rejectedFields) return Object.freeze({ ...common, status: 'confirmed', confirmedSlot: restoredU64(object.confirmedSlot) });
  if (object.status === 'rejected' && !Object.hasOwn(object, 'confirmedSlot') && (object.rejectedReason === 'preflight' || object.rejectedReason === 'program_error')) {
    return Object.freeze({ ...common, status: 'rejected', rejectedReason: object.rejectedReason, ...(Object.hasOwn(object, 'rejectedSlot') ? { rejectedSlot: restoredU64(object.rejectedSlot) } : {}) });
  }
  fail('invalid_record', 'Invalid pending lifecycle metadata');
}
/** Validates an imported public journal record without importing wire bytes or authority. */
export function decodeDirectPendingRecord(value:unknown,scope:Readonly<{program:Address;genesis:string;actor:Address}>):DirectPendingRecord{
 return restored(value,scope);
}
function defaultStorage(): DirectPendingStorage {
  const nodeRuntime = typeof process !== 'undefined' && process.release?.name === 'node';
  if (nodeRuntime && typeof window === 'undefined' && typeof document === 'undefined') return nodeStorage;
  try {
    const storage = globalThis.sessionStorage;
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' && typeof storage.removeItem === 'function') return storage;
  } catch { /* Browser denial must never fall back to ephemeral memory. */ }
  fail('storage_unavailable', 'Browser sessionStorage is unavailable; reconcile pending transactions before sending');
}
function copy(record: DirectPendingRecord): DirectPendingRecord { return Object.freeze({ ...record }); }

/** Public metadata only. Performs no RPC requests, wallet signing or transaction submission. */
export class DirectPendingJournal {
  readonly storageKey: string;
  readonly #scope: Scope;
  readonly #storage: DirectPendingStorage;
  constructor(options: DirectPendingJournalOptions) {
    this.#scope = Object.freeze({ program: key(options.program) as Address, genesis: key(options.genesis), actor: key(options.actor) as Address });
    this.storageKey = `${PREFIX}${this.#scope.program}:${this.#scope.genesis}:${this.#scope.actor}`;
    this.#storage = options.storage ?? defaultStorage();
    if (!this.#storage || typeof this.#storage.getItem !== 'function' || typeof this.#storage.setItem !== 'function' || typeof this.#storage.removeItem !== 'function') fail('storage_unavailable', 'Invalid pending metadata storage');
    this.#load();
  }
  #load(): DirectPendingRecord[] {
    let raw: string | null;
    try { raw = this.#storage.getItem(this.storageKey); }
    catch { fail('storage_unavailable', 'Cannot read pending metadata; its outcome must remain unresolved'); }
    if (raw === null) return [];
    if (typeof raw !== 'string' || raw.length > MAX_JSON_LENGTH) fail('malformed_journal', 'Pending journal exceeds its bounded format; preserve it for reconciliation');
    try {
      const envelope = shape(JSON.parse(raw), ['version', 'program', 'genesis', 'actor', 'records']);
      if (envelope.version !== 1 || !Array.isArray(envelope.records) || envelope.records.length > DIRECT_PENDING_LIMIT) fail('invalid_record', 'Unsupported or oversized pending journal');
      if (envelope.program !== this.#scope.program || envelope.genesis !== this.#scope.genesis || envelope.actor !== this.#scope.actor) fail('scope_mismatch', 'Stored journal has a foreign scope');
      const records = envelope.records.map(value => restored(value, this.#scope));
      const signatures = new Set<string>(), pendingMatches = new Set<string>();
      for (const record of records) {
        if (signatures.has(record.signature) || (record.status === 'pending' && pendingMatches.has(record.match))) fail('invalid_record', 'Duplicate signature or unresolved match in stored journal');
        signatures.add(record.signature); if (record.status === 'pending') pendingMatches.add(record.match);
      }
      return records;
    } catch (error) {
      if (error instanceof DirectPendingJournalError && error.code === 'scope_mismatch') throw error;
      fail('malformed_journal', 'Malformed pending journal; preserve it and reconcile the unknown outcomes');
    }
  }
  #write(records: readonly DirectPendingRecord[]): void {
    const serialized = JSON.stringify({ version: 1, ...this.#scope, records: records.map(record => ({ ...record, lastValidBlockHeight: record.lastValidBlockHeight.toString(), feeLamports: record.feeLamports.toString(), ...(record.status === 'confirmed' ? { confirmedSlot: record.confirmedSlot.toString() } : {}), ...(record.status === 'rejected' && record.rejectedSlot !== undefined ? { rejectedSlot: record.rejectedSlot.toString() } : {}) })) });
    if (records.length > DIRECT_PENDING_LIMIT || serialized.length > MAX_JSON_LENGTH) fail('journal_full', 'Pending journal is full; reconcile finalized or expired entries first');
    try {
      this.#storage.setItem(this.storageKey, serialized);
      if (this.#storage.getItem(this.storageKey) !== serialized) fail('storage_unavailable', 'Pending journal write could not be verified');
    } catch { fail('storage_unavailable', 'Could not persist pending metadata; sending must stop'); }
  }
  get(match: Address): DirectPendingRecord | undefined {
    const address = key(match); const record = this.#load().find(record => record.match === address && record.status === 'pending');
    return record ? copy(record) : undefined;
  }
  list(): readonly DirectPendingRecord[] { return Object.freeze(this.#load().map(copy)); }
  remember(value: DirectPendingInput): DirectPendingRecord {
    const record = input(value, this.#scope), records = this.#load();
    const existing = records.find(item => item.signature === record.signature);
    if (existing) {
      if (commonKeys.some(field => existing[field] !== record[field])) fail('pending_conflict', 'A signature already has different immutable metadata');
      return copy(existing);
    }
    if (records.some(item => item.match === record.match && item.status === 'pending')) fail('pending_conflict', 'This match has an unresolved transaction; reconcile it before signing another');
    if (records.length >= DIRECT_PENDING_LIMIT) fail('journal_full', 'Pending journal is full; no unknown outcome may be evicted');
    this.#write([...records, record]); return copy(record);
  }
  markConfirmed(match: Address, signature: Signature, slot: bigint): boolean {
    const address = key(match), sig = key(signature, 64), confirmedSlot = u64(slot), records = this.#load();
    const index = records.findIndex(record => record.match === address && record.signature === sig);
    if (index < 0) return false;
    const record = records[index];
    if (record.status === 'confirmed') {
      if (record.confirmedSlot !== confirmedSlot) fail('pending_conflict', 'Confirmation slot changed; resync before accepting another observation');
      return true;
    }
    if (record.status !== 'pending') fail('pending_conflict', 'A rejected transaction cannot silently become confirmed; reconcile the contradictory observation');
    records[index] = Object.freeze({ ...record, status: 'confirmed', confirmedSlot });
    this.#write(records); return true;
  }
  markRejected(match: Address, signature: Signature, proof: DirectPendingRejection): boolean {
    const address = key(match), sig = key(signature, 64), details = shape(proof, ['reason', 'slot'], ['reason']);
    if (details.reason !== 'preflight' && details.reason !== 'program_error') fail('invalid_record', 'Rejection requires an explicit typed preflight or program-error observation');
    const rejectedSlot = details.slot === undefined ? undefined : u64(details.slot);
    const records = this.#load(), index = records.findIndex(record => record.match === address && record.signature === sig);
    if (index < 0) return false;
    const record = records[index];
    if (record.status === 'rejected') {
      if (record.rejectedReason !== details.reason || record.rejectedSlot !== rejectedSlot) fail('pending_conflict', 'Rejection proof changed; reconcile before accepting another observation');
      return true;
    }
    if (record.status !== 'pending') fail('pending_conflict', 'A confirmed transaction cannot be rewritten as rejected');
    records[index] = Object.freeze({ ...record, status: 'rejected', rejectedReason: details.reason, ...(rejectedSlot === undefined ? {} : { rejectedSlot }) });
    this.#write(records); return true;
  }
  clear(match: Address, signature: Signature, resolution: DirectPendingResolution): boolean {
    const address = key(match), sig = key(signature, 64), records = this.#load();
    const index = records.findIndex(record => record.match === address && record.signature === sig);
    if (index < 0) return false;
    if (!resolution || (resolution.status !== 'finalized' && resolution.status !== 'expired')) fail('invalid_reconciliation', 'Only explicit finalized or expired reconciliation can clear metadata');
    if (resolution.status === 'expired') {
      let height: bigint;
      try { height = u64(resolution.blockHeight); }
      catch { fail('invalid_reconciliation', 'Expiry requires a valid observed block height'); }
      if (height <= records[index].lastValidBlockHeight) fail('invalid_reconciliation', 'Blockhash has not expired at the observed height');
    }
    this.#write(records.filter((_, position) => position !== index)); return true;
  }
}
