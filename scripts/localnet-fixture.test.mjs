import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder } from '@solana/kit';
import { ATA, MINT, SYSTEM, TOKEN, argumentsFor, mintBytes, receiver, runtimePath, tokenAddress, validateBalance, validateMint } from './localnet-fixture.mjs';

const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(9));
const other = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(11));
const info = (bytes) => ({ owner: TOKEN, executable: false, data: [Buffer.from(bytes).toString('base64'), 'base64'] });
test('fixture uses exact classic mint layout and rejects mismatched authority/owner/decimals/freeze state', () => {
  const bytes = mintBytes(signer.address);
  assert.equal(bytes.length, 82);
  assert.equal(validateMint(info(bytes), signer.address), 0n);
  assert.throws(() => validateMint(info(bytes), other.address));
  assert.throws(() => validateMint({ ...info(bytes), owner: SYSTEM }, signer.address));
  assert.throws(() => validateMint({ ...info(bytes), executable: true }, signer.address));
  for (const [offset, value] of [[0, 0], [44, 9], [45, 0], [46, 1]]) {
    const changed = Buffer.from(bytes); changed[offset] = value;
    assert.throws(() => validateMint(info(changed), signer.address));
  }
  assert.throws(() => validateMint(info(bytes.subarray(1)), signer.address));
});
test('recipient is a public owner and never a mint, program or escrow PDA', async () => {
  assert.equal(receiver(signer.address), signer.address);
  for (const rejected of [MINT, TOKEN, ATA, SYSTEM, 'not-a-wallet', await tokenAddress(signer.address)]) assert.throws(() => receiver(rejected));
});
test('runtime selection stays inside this checkout and rejects RPC/amount/token-account overrides', () => {
  assert.match(runtimePath('fresh-demo'), /localnet-fresh-demo$/);
  for (const name of ['../source', 'C:/runtime', '', 'a/b', 'A', '.runtime']) assert.throws(() => runtimePath(name));
  assert.equal(argumentsFor(['--check']).check, true);
  assert.equal(argumentsFor([signer.address, '--runtime', 'fresh', '--check'], true).owner, signer.address);
  for (const args of [['--rpc', 'https://api.devnet.solana.com'], ['--amount', '100'], ['--runtime'], ['--token-account', signer.address], [signer.address, other.address]]) assert.throws(() => argumentsFor(args, true));
});
test('token balance validation rejects a different recipient, mint, delegate or close authority', () => {
  const bytes = Buffer.alloc(165);
  bytes.set(getAddressEncoder().encode(MINT), 0);
  bytes.set(getAddressEncoder().encode(signer.address), 32);
  bytes.writeBigUInt64LE(20_000_000n, 64);
  bytes[108] = 1;
  assert.equal(validateBalance(info(bytes), signer.address), 20_000_000n);
  assert.equal(validateBalance(null, signer.address), 0n);
  assert.throws(() => validateBalance(info(bytes), other.address));
  for (const offset of [0, 72, 108, 129]) {
    const changed = Buffer.from(bytes); changed[offset] ^= 1;
    assert.throws(() => validateBalance(info(changed), signer.address));
  }
});
