import { spawnSync } from 'node:child_process';
import { cpSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run through npm run build:pages');
const base = process.env.DUSTPACT_BASE_PATH ?? '/DUSTPACT/';
for (const [workspace, suffix] of [['@dustpact/web', ''], ['@dustpact/recovery', 'recovery/']]) {
  const result = spawnSync(process.execPath, [npm, 'run', 'build', '--workspace', workspace, '--', `--base=${base}${suffix}`], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, VITE_DUSTPACT_STATIC: '1' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
cpSync(path.join(root, 'apps/recovery/dist'), path.join(root, 'apps/web/dist/recovery'), { recursive: true });
writeFileSync(path.join(root, 'apps/web/dist/.nojekyll'), '');
writeFileSync(path.join(root, 'apps/web/dist/deployment.json'), JSON.stringify({
  product: 'DUSTPACT', mode: 'offchain-practice', commit: process.env.GITHUB_SHA ?? 'local',
  onlineConfigured: false,
}) + '\n');
