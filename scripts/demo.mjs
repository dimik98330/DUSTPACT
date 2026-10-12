import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
if (!npm) throw Error('Start with npm run demo');
const port = Number(process.env.DUSTPACT_DEMO_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid DUSTPACT_DEMO_PORT');
const route = '/?version=3&mode=practice&tutorial=0';
console.log(`DUSTPACT offline practice: http://127.0.0.1:${port}${route}`);
console.log('This mode uses Rust/Wasm locally. It needs no wallet, RPC, PostgreSQL or test tokens.');
const child = spawn(process.execPath, [npm, 'run', 'dev', '--workspace', '@dustpact/web', '--', '--port', String(port), '--open', route], {
  cwd: root, stdio: 'inherit', windowsHide: true, shell: false,
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill(signal); });
