/** LOCAL-ONLY generated token fixture. Never import a user key or contact a public RPC. */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { address, createKeyPairSignerFromPrivateKeyBytes, createSolanaRpc, getAddressEncoder, getProgramDerivedAddress, isOffCurveAddress } from '@solana/kit';

export const RPC = 'http://127.0.0.1:19809';
export const MINT = address('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ATA = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SYSTEM = address('11111111111111111111111111111111');
export const AMOUNT = 20_000_000n;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const send = (request) => request.send({ abortSignal: AbortSignal.timeout(8000) });
export function runtimePath(name) {
  if (name !== undefined && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw Error('Runtime name must contain only lowercase letters, digits and hyphens, at most 40 characters.');
  return path.join(ROOT, '.runtime', name ? `localnet-${name}` : 'localnet');
}
export function argumentsFor(args, allowOwner = false) {
  let name, owner, check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check' && !check) check = true;
    else if (args[i] === '--runtime' && name === undefined && args[i + 1]) name = args[++i];
    else if (allowOwner && !args[i].startsWith('-') && owner === undefined) owner = receiver(args[i]);
    else throw Error('Use --check, --runtime <new-name>, and (for localnet:tokens) one public owner address. RPC, mint, amount and token account overrides are not supported.');
  }
  return { runtime: runtimePath(name), name, owner, check };
}
export function receiver(value) {
  let owner;
  try { owner = address(value); } catch { throw Error('Provide a canonical public wallet/profile address.'); }
  if (isOffCurveAddress(owner) || [MINT, TOKEN, ATA, SYSTEM].includes(owner)) throw Error('Recipient must be an on-curve public wallet/profile owner, never a program, escrow or PDA.');
  return owner;
}
export async function tokenAddress(owner) {
  return (await getProgramDerivedAddress({ programAddress: ATA, seeds: [getAddressEncoder().encode(owner), getAddressEncoder().encode(TOKEN), getAddressEncoder().encode(MINT)] }))[0];
}
export function mintBytes(authority) {
  const bytes = Buffer.alloc(82);
  bytes.writeUInt32LE(1, 0);
  bytes.set(getAddressEncoder().encode(authority), 4);
  bytes[44] = 6;
  bytes[45] = 1;
  return bytes;
}
function accountBytes(info, length) {
  if (!info || info.owner !== TOKEN || info.executable !== false || !Array.isArray(info.data) || info.data[1] !== 'base64' || typeof info.data[0] !== 'string') throw Error('Local token account owner/encoding is invalid.');
  const bytes = Buffer.from(info.data[0], 'base64');
  if (bytes.length !== length || bytes.toString('base64') !== info.data[0]) throw Error('Local token account layout is invalid.');
  return bytes;
}
export function validateMint(info, authority) {
  const bytes = accountBytes(info, 82);
  if (bytes.readUInt32LE(0) !== 1 || !bytes.subarray(4, 36).equals(Buffer.from(getAddressEncoder().encode(authority))) || bytes[44] !== 6 || bytes[45] !== 1 || bytes.readUInt32LE(46) !== 0) throw Error('Local mint authority, decimals or initialization differs from the generated fixture. No funding is allowed.');
  return bytes.readBigUInt64LE(36);
}
export function validateBalance(info, owner) {
  if (!info) return 0n;
  const bytes = accountBytes(info, 165);
  if (!bytes.subarray(0, 32).equals(Buffer.from(getAddressEncoder().encode(MINT))) || !bytes.subarray(32, 64).equals(Buffer.from(getAddressEncoder().encode(owner))) || bytes[108] !== 1 || bytes.readUInt32LE(72) !== 0 || bytes.readUInt32LE(129) !== 0) throw Error('Recipient canonical ATA differs from the requested owner/mint or has delegation.');
  return bytes.readBigUInt64LE(64);
}
export async function exists(file) { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export async function readFixture(runtime, requireGenesis = true) {
  let seed, metadata, genesis;
  try {
    seed = await readFile(path.join(runtime, 'mint-authority.seed'));
    metadata = JSON.parse(await readFile(path.join(runtime, 'token-fixture.json'), 'utf8'));
    if (requireGenesis) genesis = (await readFile(path.join(runtime, 'genesis.txt'), 'utf8')).trim();
  } catch { throw Error('This runtime lacks its generated token fixture/genesis marker. Preserve it; use npm run localnet -- --runtime tokens-demo for a separate fresh owned ledger. Never reset or adopt an existing ledger.'); }
  if (seed.length !== 32) throw Error('Generated local mint authority has invalid length. No key was imported.');
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  seed.fill(0);
  if (metadata.version !== 1 || metadata.rpc !== RPC || metadata.mint !== MINT || metadata.authority !== signer.address || metadata.decimals !== 6 || (requireGenesis && (!genesis || genesis !== address(genesis)))) throw Error('Generated token fixture metadata/genesis mismatch. No funding is allowed.');
  return { signer, metadata, genesis };
}
export async function prepareFixture(runtime, existingLedger) {
  if (existingLedger) {
    const fixture = await readFixture(runtime);
    const dump = JSON.parse(await readFile(path.join(runtime, 'mint.json'), 'utf8'));
    if (dump.pubkey !== MINT) throw Error('Retained mint snapshot does not name the fixed local test mint.');
    validateMint(dump.account, fixture.signer.address);
    return fixture;
  }
  await mkdir(runtime, { recursive: true });
  const seedFile = path.join(runtime, 'mint-authority.seed');
  if (!await exists(seedFile)) {
    const seed = randomBytes(32);
    try { await writeFile(seedFile, seed, { flag: 'wx', mode: 0o600 }); } finally { seed.fill(0); }
  }
  const seed = await readFile(seedFile);
  if (seed.length !== 32) throw Error('Generated fixture authority is invalid. Preserve runtime for review.');
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  seed.fill(0);
  const metadata = { version: 1, rpc: RPC, mint: MINT, authority: signer.address, decimals: 6, scope: 'Generated local fixture only; not issued by Circle; no public/devnet signing or user keys.' };
  const dump = { pubkey: MINT, account: { lamports: 3_000_000, data: [mintBytes(signer.address).toString('base64'), 'base64'], owner: TOKEN, executable: false, rentEpoch: 0, space: 82 } };
  await writeFile(path.join(runtime, 'mint.json'), JSON.stringify(dump) + '\n');
  await writeFile(path.join(runtime, 'token-fixture.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { signer, metadata };
}
export async function checkedFixture(runtime, options = {}) {
  const fixture = await readFixture(runtime, options.genesis === undefined);
  const expectedGenesis = options.genesis ?? fixture.genesis;
  const rpc = createSolanaRpc(RPC);
  if (await send(rpc.getGenesisHash()) !== expectedGenesis) throw Error('RPC19809 genesis differs from the selected owned runtime. No funding is allowed.');
  const mint = (await send(rpc.getAccountInfo(MINT, { encoding: 'base64', commitment: 'finalized' }))).value;
  const supply = validateMint(mint, fixture.signer.address);
  for (const program of [TOKEN, ATA]) {
    if (!(await send(rpc.getAccountInfo(program, { encoding: 'base64', commitment: 'finalized' }))).value?.executable) throw Error('Required classic Token/ATA program is unavailable on the owned localnet.');
  }
  return { ...fixture, genesis: expectedGenesis, rpc, supply };
}
