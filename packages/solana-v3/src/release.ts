import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  type Address,
  type GetGenesisHashApi,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import { PROGRAM_V3, VAULT_PROGRAM } from "./constants";

/** Build-time reviewed V3 release policies; no remote policy auto-trust. */
export const UPGRADEABLE_LOADER = address(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const PROGRAM_BYTES = 36;
const PROGRAM_DATA_METADATA_BYTES = 45;
const MAX_U64 = (1n << 64n) - 1n;

export type TrustedReleasePolicy = Readonly<{
  version: 3; executableBytes: number;
  program: Address;
  genesisHash: string;
  sbfSha256: string;
  upgradeAuthority:
    | Readonly<{ kind: "immutable" }>
    | Readonly<{ kind: "address"; address: Address }>;
}>;
export type VerifiedDeployment = Readonly<{
  program: Address;
  genesisHash: string;
  programData: Address;
  observedSlot: bigint;
  programDataSlot: bigint;
  upgradeAuthority: Address | null;
  immutable: boolean;
  sbfSha256: string;
  executableBytes: number;
}>;
export type ReleaseRpc = Rpc<GetGenesisHashApi & GetMultipleAccountsApi>;
export class DeploymentVerificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentVerificationError";
  }
}
function reject(code: string, message: string): never {
  throw new DeploymentVerificationError(code, message);
}
function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject(code, "Проверка развёртывания получила неверный формат данных.");
  return value as Record<string, unknown>;
}
function fields(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const record = object(value, "invalid_policy");
  if (
    Object.getOwnPropertySymbols(record).length ||
    Object.getOwnPropertyNames(record).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key)) ||
    Object.values(Object.getOwnPropertyDescriptors(record)).some(
      (descriptor) => !("value" in descriptor),
    )
  )
    reject(
      "invalid_policy",
      "Конфигурация release должна содержать только явные проверенные поля.",
    );
  return record;
}
function publicKey(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    reject(
      "invalid_policy",
      "Неверный публичный адрес или genesis hash в release policy.",
    );
  try {
    const bytes = getBase58Encoder().encode(value);
    if (bytes.length === 32 && getBase58Decoder().decode(bytes) === value)
      return value;
  } catch {
    /* The policy is rejected below, without exposing RPC data. */
  }
  return reject(
    "invalid_policy",
    "Release policy требует канонический 32-байтный base58 идентификатор.",
  );
}

/** Snapshot synchronously before the first await; never fetch or auto-trust a remote policy. */
export function snapshotReleasePolicy(
  input: TrustedReleasePolicy,
): TrustedReleasePolicy {
  const policy = fields(input, [
    "version",
    "program",
    "genesisHash",
    "sbfSha256",
    "upgradeAuthority", "executableBytes",
  ]);
  if (
    policy.version !== 3 ||
    !([PROGRAM_V3, VAULT_PROGRAM] as Address[]).includes(policy.program as Address) ||
    typeof policy.sbfSha256 !== "string" || !/^[a-f0-9]{64}$/.test(policy.sbfSha256) || typeof policy.executableBytes !== "number" || !Number.isSafeInteger(policy.executableBytes) || policy.executableBytes < 1000 || policy.executableBytes > 1500000
  )
    reject(
      "invalid_policy",
      "Release policy не соответствует текущим PROGRAM и проверенному бинарнику V3.",
    );
  const authority = object(policy.upgradeAuthority, "invalid_policy");
  let upgradeAuthority: TrustedReleasePolicy["upgradeAuthority"];
  if (authority.kind === "immutable") {
    fields(authority, ["kind"]);
    upgradeAuthority = Object.freeze({ kind: "immutable" });
  } else if (authority.kind === "address") {
    fields(authority, ["kind", "address"]);
    upgradeAuthority = Object.freeze({
      kind: "address",
      address: publicKey(authority.address) as Address,
    });
  } else reject("invalid_policy", "Укажите явную политику upgrade authority.");
  return Object.freeze({
    version: 3, executableBytes: policy.executableBytes as number,
    program: policy.program as Address,
    genesisHash: publicKey(policy.genesisHash),
    sbfSha256: policy.sbfSha256 as string,
    upgradeAuthority,
  });
}

function uint64(value: unknown, code: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U64)
    reject(code, "RPC вернул некорректное целое значение аккаунта программы.");
  return value;
}
function accountBytes(
  value: unknown,
  length: number,
  executable: boolean,
  code: string,
): Uint8Array {
  const account = object(value, code);
  if (
    account.owner !== UPGRADEABLE_LOADER ||
    account.executable !== executable ||
    uint64(account.lamports, code) === 0n
  )
    reject(
      code,
      "Неверный loader, executable flag или нулевой баланс аккаунта программы.",
    );
  const data = account.data;
  if (
    !Array.isArray(data) ||
    data.length !== 2 ||
    data[1] !== "base64" ||
    typeof data[0] !== "string" ||
    data[0].length !== Math.ceil(length / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data[0])
  )
    reject(code, "Неверный размер или кодирование аккаунта программы.");
  const bytes = Uint8Array.from(getBase64Encoder().encode(data[0]));
  if (bytes.length !== length || getBase64Decoder().decode(bytes) !== data[0])
    reject(code, "Неканонические или неполные байты аккаунта программы.");
  return bytes;
}

/** Read-only verification against the selected RPC; the RPC itself remains a trust boundary. */
export async function verifyDeployment(
  rpc: ReleaseRpc,
  reviewedPolicy: TrustedReleasePolicy,
  options: { abortSignal?: AbortSignal } = {},
): Promise<VerifiedDeployment> {
  const policy = snapshotReleasePolicy(reviewedPolicy),
    signal = options.abortSignal;
  signal?.throwIfAborted();
  try {
    const genesis = await rpc.getGenesisHash().send({ abortSignal: signal });
    signal?.throwIfAborted();
    if (genesis !== policy.genesisHash)
      reject(
        "genesis_mismatch",
        "Выбранный RPC относится к другой сети. Подпись остановлена.",
      );
    const [programData] = await getProgramDerivedAddress({
      programAddress: UPGRADEABLE_LOADER,
      seeds: [getAddressEncoder().encode(policy.program)],
    });
    signal?.throwIfAborted();
    // One response/context avoids combining Program and ProgramData from different slots.
    const result = object(
      await rpc
        .getMultipleAccounts([policy.program, programData], {
          encoding: "base64",
          commitment: "finalized",
        })
        .send({ abortSignal: signal }),
      "invalid_rpc",
    );
    signal?.throwIfAborted();
    const observedSlot = uint64(
      object(result.context, "invalid_rpc").slot,
      "invalid_rpc",
    );
    if (!Array.isArray(result.value) || result.value.length !== 2)
      reject("invalid_rpc", "RPC не вернул оба аккаунта развёртывания.");
    const program = accountBytes(
      result.value[0],
      PROGRAM_BYTES,
      true,
      "invalid_program",
    );
    const programView = new DataView(
      program.buffer,
      program.byteOffset,
      program.byteLength,
    );
    if (
      programView.getUint32(0, true) !== 2 ||
      getAddressDecoder().decode(program.subarray(4, 36)) !== programData
    )
      reject(
        "invalid_program",
        "Program не указывает на ожидаемый ProgramData PDA.",
      );
    const data = accountBytes(
      result.value[1],
      PROGRAM_DATA_METADATA_BYTES + policy.executableBytes,
      false,
      "invalid_programdata",
    );
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const programDataSlot = view.getBigUint64(4, true);
    if (
      view.getUint32(0, true) !== 3 ||
      programDataSlot > observedSlot ||
      (data[12] !== 0 && data[12] !== 1)
    )
      reject(
        "invalid_programdata",
        "Неверное состояние, slot или Option upgrade authority в ProgramData.",
      );
    // Some(111...) remains present. Bytes after None may contain old serialized authority.
    const upgradeAuthority =
      data[12] === 1 ? getAddressDecoder().decode(data.subarray(13, 45)) : null;
    if (
      policy.upgradeAuthority.kind === "immutable"
        ? upgradeAuthority !== null
        : upgradeAuthority !== policy.upgradeAuthority.address
    )
      reject(
        "authority_mismatch",
        "Upgrade authority не соответствует явно согласованной политике release.",
      );
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        data.slice(PROGRAM_DATA_METADATA_BYTES),
      ),
    );
    signal?.throwIfAborted();
    const sbfSha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (sbfSha256 !== policy.sbfSha256)
      reject(
        "binary_mismatch",
        "Бинарник в ProgramData не совпадает с проверенным release. Подпись остановлена.",
      );
    return Object.freeze({
      program: policy.program,
      genesisHash: policy.genesisHash,
      programData,
      observedSlot,
      programDataSlot,
      upgradeAuthority,
      immutable: upgradeAuthority === null,
      sbfSha256,
      executableBytes: policy.executableBytes,
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof DeploymentVerificationError) throw error;
    return reject(
      "rpc_unavailable",
      "Не удалось проверить развёртывание через RPC. Подпись остановлена.",
    );
  }
}
