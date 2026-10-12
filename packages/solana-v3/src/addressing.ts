import {getProgramDerivedAddress,getAddressEncoder,getUtf8Encoder,type Address} from '@solana/kit';
import {PROGRAM_V3,VAULT_PROGRAM,TOKEN,ATA_PROGRAM,USDC_MINT} from './constants';
export async function matchAddress(creator:Address,nonce:Uint8Array){if(nonce.length!==16)throw Error('Match nonce must be 16 bytes');return getProgramDerivedAddress({programAddress:PROGRAM_V3,seeds:[getUtf8Encoder().encode('match-v3'),getAddressEncoder().encode(creator),nonce]});}
export async function missionAddress(match:Address){return getProgramDerivedAddress({programAddress:VAULT_PROGRAM,seeds:[getUtf8Encoder().encode('mission'),getAddressEncoder().encode(match)]});}
export async function tokenAddress(owner:Address){return getProgramDerivedAddress({programAddress:ATA_PROGRAM,seeds:[getAddressEncoder().encode(owner),getAddressEncoder().encode(TOKEN),getAddressEncoder().encode(USDC_MINT)]});}
