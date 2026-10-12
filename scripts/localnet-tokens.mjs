/** Explicit local-only grant of exactly 20 valueless fixture tokens. No public RPC override. */
import { open, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { appendTransactionMessageInstructions, createTransactionMessage, getBase64EncodedWireTransaction, getSignatureFromTransaction, getStructEncoder, getU8Encoder, getU64Encoder, lamports, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners } from '@solana/kit';
import { AMOUNT, ATA, MINT, RPC, SYSTEM, TOKEN, argumentsFor, checkedFixture, send, tokenAddress, validateBalance } from './localnet-fixture.mjs';

const options = argumentsFor(process.argv.slice(2), true);
if (!options.check && !options.owner) throw Error('Usage: npm run localnet:tokens -- <public-owner-address> [--runtime name], or --check [owner]. This explicitly authorizes only a generated local fixture signer.');
const fixture = await checkedFixture(options.runtime);
const { rpc, signer, genesis } = fixture;
const journalFile = path.join(options.runtime, 'token-faucet-last.json');
let prior;
try { prior = JSON.parse(await readFile(journalFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw Error('Local faucet journal cannot be read. Preserve it for review.'); }
let priorStatus;
if (prior) {
  if (prior.genesis !== genesis) throw Error('Prior local faucet transaction belongs to a different genesis. Nothing signed.');
  priorStatus = (await send(rpc.getSignatureStatuses([prior.signature], { searchTransactionHistory: true }))).value[0];
}
let recipient, before;
if (options.owner) {
  const ownerAccount = (await send(rpc.getAccountInfo(options.owner, { encoding: 'base64', commitment: 'finalized' }))).value;
  if (ownerAccount && (ownerAccount.executable || ownerAccount.owner !== SYSTEM)) throw Error('Recipient is a program or non-wallet account, not a public profile owner.');
  recipient = await tokenAddress(options.owner);
  before = validateBalance((await send(rpc.getAccountInfo(recipient, { encoding: 'base64', commitment: 'finalized' }))).value, options.owner);
}
if (options.check) {
  console.log(JSON.stringify({ ready: true, rpc: RPC, genesis, mint: MINT, authority: signer.address, decimals: 6, localFixtureOnly: true, ...(options.owner ? { owner: options.owner, canonicalAta: recipient, balanceBaseUnits: before.toString() } : {}), ...(prior ? { lastSignature: prior.signature, lastStatus: priorStatus?.err ? 'rejected' : priorStatus?.confirmationStatus ?? 'unknown; do not grant again' } : {}) }, null, 2));
} else {
  const lockFile = path.join(options.runtime, 'token-faucet.lock');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); } catch { throw Error('Another faucet grant may be running. Inspect --check and the local journal; do not delete a ledger or sign concurrently.'); }
  try {
    // Re-read under the exclusive lock so another invocation cannot race this grant.
    let latest;
    try { latest = JSON.parse(await readFile(journalFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (latest) {
      if (latest.genesis !== genesis) throw Error('Faucet journal genesis mismatch.');
      const status = (await send(rpc.getSignatureStatuses([latest.signature], { searchTransactionHistory: true }))).value[0];
      if (!status || !status.err && status.confirmationStatus !== 'finalized') throw Error(`Prior faucet grant is not finalized. Use --check; do not sign again. Public signature: ${latest.signature}`);
    }
    await checkedFixture(options.runtime);
    before = validateBalance((await send(rpc.getAccountInfo(recipient, { encoding: 'base64', commitment: 'finalized' }))).value, options.owner);
    const balance = (await send(rpc.getBalance(signer.address, { commitment: 'confirmed' }))).value;
    if (balance < 20_000_000n) {
      await checkedFixture(options.runtime);
      const signature = await send(rpc.requestAirdrop(signer.address, lamports(100_000_000n), { commitment: 'confirmed' }));
      await confirmed(signature, false);
    }
    // Official SPL layouts encoded by the existing Solana Kit codecs; no new dependencies.
    // Token MintToChecked: https://github.com/solana-program/token/blob/main/interface/src/instruction.rs
    // ATA CreateIdempotent: https://github.com/solana-program/associated-token-account/blob/main/interface/src/instruction.rs
    const createAta = { programAddress: ATA, accounts: [{ address: signer.address, role: 3, signer }, { address: recipient, role: 1 }, { address: options.owner, role: 0 }, { address: MINT, role: 0 }, { address: SYSTEM, role: 0 }, { address: TOKEN, role: 0 }], data: getU8Encoder().encode(1) };
    const mint = { programAddress: TOKEN, accounts: [{ address: MINT, role: 1 }, { address: recipient, role: 1 }, { address: signer.address, role: 2, signer }], data: getStructEncoder([['discriminator', getU8Encoder()], ['amount', getU64Encoder()], ['decimals', getU8Encoder()]]).encode({ discriminator: 14, amount: AMOUNT, decimals: 6 }) };
    const lifetime = (await send(rpc.getLatestBlockhash({ commitment: 'confirmed' }))).value;
    const message = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(signer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m), (m) => appendTransactionMessageInstructions([createAta, mint], m));
    await checkedFixture(options.runtime);
    const signed = await signTransactionMessageWithSigners(message);
    const wire = getBase64EncodedWireTransaction(signed), signature = getSignatureFromTransaction(signed);
    if ((await send(rpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }))).value.err) throw Error('Local fixture grant simulation failed. No mint transaction submitted.');
    await checkedFixture(options.runtime);
    const journal = { genesis, owner: options.owner, ata: recipient, amountBaseUnits: AMOUNT.toString(), signature, lastValidBlockHeight: lifetime.lastValidBlockHeight.toString(), status: 'prepared' };
    await writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n');
    try { if (await send(rpc.sendTransaction(wire, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' })) !== signature) throw Error('RPC signature mismatch'); }
    catch { throw Error(`Local grant submission is unknown. Use --check without resubmitting. Public signature: ${signature}`); }
    await confirmed(signature, true);
    await checkedFixture(options.runtime);
    const after = validateBalance((await send(rpc.getAccountInfo(recipient, { encoding: 'base64', commitment: 'finalized' }))).value, options.owner);
    if (after !== before + AMOUNT) throw Error('Finalized token balance differs from the exact 20-token grant; inspect the public signature.');
    await writeFile(journalFile, JSON.stringify({ ...journal, status: 'finalized' }, null, 2) + '\n');
    console.log(JSON.stringify({ granted: '20', asset: 'LOCAL TEST tokens, not Circle-issued USDC', owner: options.owner, canonicalAta: recipient, signature, finalizedBalanceBaseUnits: after.toString() }, null, 2));
    console.log('Return to the lobby. Review and sign the separate 20-token PactVault deposit before departure.');
  } finally { await lock.close(); await unlink(lockFile); }
}
async function confirmed(signature, finalized) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const status = (await send(rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }))).value[0];
    if (status?.err) throw Error(`Local fixture transaction rejected. Public signature: ${signature}`);
    if (status?.confirmationStatus === 'finalized' || !finalized && status?.confirmationStatus === 'confirmed') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error(`Local confirmation remains unknown. Do not resubmit. Public signature: ${signature}`);
}
