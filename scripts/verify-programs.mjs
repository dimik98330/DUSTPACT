import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const programs = Object.freeze([
  { version: 3, name: 'game_v3', id: 'EEs4JyRG3Cs84rtYq2rupywf6YHDW426oACzspsHE7Mm', file: 'target/v3-deploy/game_v3.so', bytes: 376104, sha256: '765932448513b695ec170c5961d8072f295cf58d5ead8be6d6cae31d01e58a91' },
  { version: 3, name: 'pact_vault_v3', id: 'E6rQv7ohsEL1XtCySvQodTRiEY2sdaMiwDoJdktaiseA', file: 'target/v3-deploy/pact_vault_v3.so', bytes: 241664, sha256: '2153724a7eb87522ed8a0855d8050218f8403aae8be70a787930bbebccb2e583' },
  { version: 2, name: 'game_v2', id: '7Fs272UohH4jF53fwsdVk3E9t4KuDptdn6DcFyxbuARd', file: 'target/v2-deploy/game_v2.so', bytes: 330560, sha256: 'e2ccb5b037c0876ecd3c8dcd217da80620d47d06897fcd31348052aab95126a1' },
  { version: 2, name: 'pact_vault', id: 'FdmDeHDFdxrraqSXdprzDPieSLZMbQCkEPr5rjokRtBR', file: 'target/v2-deploy/pact_vault.so', bytes: 240272, sha256: 'b7cc5fb4057de7d33d3167c758d21fb81c112a2e8152c21ff7c18ecc535579a5' },
]);
export async function verifyPrograms(mode = 'all') {
  if (!['all', 'v3'].includes(mode)) throw Error('Program set must be all or v3');
  const selected = programs.filter((program) => mode === 'all' || program.version === 3);
  for (const program of selected) {
    const bytes = await readFile(path.join(root, program.file));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== program.bytes || hash !== program.sha256) throw Error(`${program.name}: rebuilt SBF does not match the reviewed release. Expected ${program.sha256} (${program.bytes} bytes); got ${hash} (${bytes.length} bytes). Stop and review the toolchain/build before using localnet; no deployment pin was changed.`);
    console.log(`${program.name}: reviewed SBF hash verified`);
  }
  return selected;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyPrograms(process.argv[2] ?? 'all');
