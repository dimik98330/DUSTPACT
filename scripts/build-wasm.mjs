import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) throw Error(`${command} must be installed on PATH: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('rustc', ['--version']);
run('cargo', ['--version']);
// Build separately: V3 enables V2's no-wasm-exports feature in its dependency graph.
// A combined build would unify that feature and remove the standalone V2 exports.
for (const version of ['v2', 'v3']) {
  const target = path.join(root, 'target', `wasm-${version}`);
  run('cargo', ['build', '--package', `dustpact-rules-${version}`, '--release', '--target', 'wasm32-unknown-unknown', '--locked', '--target-dir', target]);
  const built = path.join(target, 'wasm32-unknown-unknown', 'release', `dustpact_rules_${version}.wasm`);
  const bytes = await readFile(built);
  if (!bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw Error(`Invalid ${version} Wasm output`);
  for (const app of ['web', 'recovery']) {
    const directory = path.join(root, 'apps', app, 'public', 'engine');
    await mkdir(directory, { recursive: true });
    await copyFile(built, path.join(directory, `rules-${version}.wasm`));
  }
  console.log(`Rebuilt rules-${version}.wasm for both browser clients.`);
}
