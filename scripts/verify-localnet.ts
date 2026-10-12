/** Read-only, pinned ProgramData verification. No keys, signing or funding. */
import { address, createSolanaRpc } from '@solana/kit';
import { verifyDeployment, type TrustedReleasePolicy } from '../packages/solana-v3/src/release.ts';
import { SYSTEM } from '../packages/solana-v3/src/constants.ts';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:19809';
if (endpoint !== 'http://127.0.0.1:19809') throw Error('This helper only verifies the separate public-checkout localnet');
const rpc = createSolanaRpc(endpoint);
const genesisHash = await rpc.getGenesisHash().send();
const policies: TrustedReleasePolicy[] = [
  { version: 3, program: address('EEs4JyRG3Cs84rtYq2rupywf6YHDW426oACzspsHE7Mm'), genesisHash, sbfSha256: '765932448513b695ec170c5961d8072f295cf58d5ead8be6d6cae31d01e58a91', executableBytes: 376104, upgradeAuthority: { kind: 'address', address: SYSTEM } },
  { version: 3, program: address('E6rQv7ohsEL1XtCySvQodTRiEY2sdaMiwDoJdktaiseA'), genesisHash, sbfSha256: '2153724a7eb87522ed8a0855d8050218f8403aae8be70a787930bbebccb2e583', executableBytes: 241664, upgradeAuthority: { kind: 'address', address: SYSTEM } },
];
for (const policy of policies) {
  await verifyDeployment(rpc, policy);
  console.log(`Local ProgramData verified: ${policy.program}`);
}
