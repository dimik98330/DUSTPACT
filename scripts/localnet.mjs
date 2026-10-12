import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPrograms } from './verify-programs.mjs';
import { argumentsFor, checkedFixture, prepareFixture, RPC } from './localnet-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = argumentsFor(process.argv.slice(2));
const runtime = options.runtime;
const ledger = path.join(runtime, 'ledger');
const rpcPort = 19809, gossipPort = 19911, faucetPort = 19912;
const rpc = RPC;
const selected = await verifyPrograms('v3');
if (options.check) {
  const fixture = await checkedFixture(runtime);
  console.log(JSON.stringify({ ready: true, rpc, genesis: fixture.genesis, mint: fixture.metadata.mint, authority: fixture.metadata.authority, runtime, localFixtureOnly: true }, null, 2));
  process.exit(0);
}
async function available(port, udp = false) {
  const socket = udp ? createSocket('udp4') : createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', () => reject(Error(`Port ${port} is occupied. Nothing was stopped or reset.`)));
    if (udp) socket.bind(port, '127.0.0.1', () => socket.close(resolve));
    else socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}
for (const port of [rpcPort, rpcPort + 1, faucetPort]) await available(port);
await available(gossipPort, true);
for (let port = 42900; port <= 42940; port++) { await available(port); await available(port, true); }
await mkdir(runtime, { recursive: true });
const genesisFile = path.join(runtime, 'genesis.txt');
let retainedGenesis;
try { retainedGenesis = (await readFile(genesisFile, 'utf8')).trim(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let existing = false;
try { await stat(path.join(ledger, 'genesis.bin')); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing && !retainedGenesis) throw Error('Existing ledger has no retained genesis marker. Review it manually; no reset or automatic adoption is allowed.');
await prepareFixture(runtime, existing);
const args = ['--ledger', ledger, '--rpc-port', String(rpcPort), '--faucet-port', String(faucetPort), '--gossip-port', String(gossipPort), '--dynamic-port-range', '42900-42940', '--bind-address', '127.0.0.1', '--limit-ledger-size', '100000'];
if (!existing) for (const program of selected) args.push('--upgradeable-program', program.id, path.join(root, program.file), 'none');
if (!existing) args.push('--account', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', path.join(runtime, 'mint.json'));
console.log(`DUSTPACT separate ${existing ? 'retained' : 'NEW'} localnet: ${rpc}`);
console.log(`Ledger: ${ledger}`);
console.log('This starts a local fixture network with pinned programs. It performs no public deployment. Ctrl+C stops this child validator; the ledger is retained.');
console.log('A new local-only token authority is generated under this ignored runtime. It authorizes only explicit localnet:tokens grants; no user key is read.');
const child = spawn('solana-test-validator', args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
let exited = false;
child.on('error', (error) => { exited = true; console.error(`solana-test-validator must be installed on PATH: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code) => { exited = true; process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill(signal); });
for (let attempt = 0; attempt < 60 && !exited; attempt++) {
  try {
    const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }), signal: AbortSignal.timeout(1000) });
    const result = await response.json();
    if (typeof result.result === 'string') {
      if (retainedGenesis && retainedGenesis !== result.result) { child.kill('SIGTERM'); throw Error('Retained ledger genesis mismatch; validator stopped and ledger preserved.'); }
      await new Promise((resolve, reject) => {
        const verifier = spawn(process.execPath, ['--import', 'tsx', 'scripts/verify-localnet.ts', rpc], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
        verifier.once('error', reject);
        verifier.once('exit', (code) => code === 0 ? resolve() : reject(Error('Local ProgramData verification failed; no deployment pins were changed.')));
      }).catch((error) => { child.kill('SIGTERM'); throw error; });
      await checkedFixture(runtime, { genesis: result.result }).catch((error) => { child.kill('SIGTERM'); throw Error(`Local token fixture verification failed: ${error.message}`); });
      await writeFile(genesisFile, result.result + '\n');
      console.log(`Healthy local RPC. Genesis pinned in .runtime/localnet/genesis.txt: ${result.result}`);
      console.log('Open http://127.0.0.1:4173/?version=3 for generated Localnet actors. Optional backend uses ports 4197/4198.');
      console.log(`For the optional mission, copy your Profile owner address and run npm run localnet:tokens -- <owner>${options.name ? ` --runtime ${options.name}` : ''}`);
      break;
    }
  } catch (error) {
    if (error.message?.includes('genesis mismatch') || error.message?.includes('ProgramData verification failed') || error.message?.includes('Local token fixture verification failed')) throw error;
  }
  if (attempt === 59) { child.kill('SIGTERM'); throw Error('Local validator did not become ready; ledger preserved.'); }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
