# Run DUSTPACT locally

[English README](../README.md) · [Русский README](../README.ru.md) · [Кратко по-русски](#кратко-по-русски)

The quickest path is the wallet-free learning expedition. The native Localnet stack is a separate developer path: it runs real Solana programs on a private validator, using generated local identities and valueless test tokens. This repository does not include a reviewed public deployment.

## 1. Play the learning expedition

Install **Node.js 22.12 or newer** and npm, then run from the repository root:

```bash
npm ci
npm run demo
```

Open [127.0.0.1:4173](http://127.0.0.1:4173/?version=3&mode=practice&tutorial=0&lang=en). The command opens the browser when the environment supports it. Windows PowerShell, macOS and Linux can use this path. Rust/Wasm browser assets are already included: no wallet, RPC, Docker, Rust installation or tokens are needed.

Learning resolves the game offchain. The three other travelers are labeled game agents. It cannot demonstrate an onchain payment or independent wallet participation.

Use `npm run dev` to open the regular entry screen instead. `Ctrl+C` stops the browser development server. If port 4173 is busy, choose an unused port:

Set `DUSTPACT_DEMO_PORT` in your shell:

```bash
# Bash
DUSTPACT_DEMO_PORT=4175 npm run demo
```

```powershell
# PowerShell
$env:DUSTPACT_DEMO_PORT = '4175'
npm run demo
```

## 2. Check and build the browser clients

```bash
npm run typecheck
npm run backend:typecheck
npm test
npm run build
```

`build` produces both `apps/web/dist` and `apps/recovery/dist`. `npm run preview` serves the built game on port 4173. A successful web build does not establish a working public Solana deployment.

To rebuild the shared browser rules, install Rust and its Wasm target:

```bash
rustup target add wasm32-unknown-unknown
npm run build:wasm
npm run test:rust
```

The Wasm helper builds protocol 2 and 3 separately and copies them into both browser clients. This preserves the compatibility exports used by protocol 3. The native build below has stricter toolchain requirements.

## 3. Build the native Solana programs

Use **Linux, macOS or WSL with Bash**. On Windows, keep the native working copy in WSL's Linux filesystem and run Node, npm, Rust and the Solana tools inside the **same WSL environment**. A Windows `node.exe` launched from WSL cannot reliably execute the Linux toolchain.

Required tools on that environment's `PATH`:

| Tool               | Reviewed version / requirement      |
| ------------------ | ----------------------------------- |
| Node and npm       | Node 22.12+                         |
| Host Rust          | `cargo` / `rustc` 1.91.0            |
| SBF builder        | `solana-cargo-build-sbf` 3.1.10     |
| SBF platform tools | v1.52, selected by the build script |
| Validator and CLI  | `solana-test-validator`, `solana`   |

Install these tools from their official distributions before continuing. The project scripts use tools already on `PATH`; they do not install the Solana toolchain or download unpublished program binaries.

```bash
node --version
cargo --version
rustc --version
cargo build-sbf --version
solana-test-validator --version
npm ci
npm run build:programs
```

The helper builds the current GameV3 and PactVaultV3. It compares each SBF binary's size and SHA-256 with the reviewed release pins in [`scripts/verify-programs.mjs`](../scripts/verify-programs.mjs). A mismatch is a hard failure. Review the toolchain/build result; do not change pins just to bypass the check. The fresh Localnet preloads only protocol 3; preserved protocol 2 source/fixtures are compatibility dependencies, not an additional deployment requirement.

`npm run test:native` is the broader Rust workspace test suite, including native programs and compatibility fixtures. It needs the fixture/build setup expected by those tests and is separate from the fresh V3-only startup path. The Node-only checks above do not replace native-program testing.

## 4. Start the native game

In terminal A:

```bash
npm run localnet
```

Wait for `Healthy local RPC` and successful ProgramData verification. The launcher uses RPC **19809**, installs the pinned programs into a new local genesis and keeps its ledger at `.runtime/localnet/ledger`. On later starts it retains that ledger and checks the saved genesis marker. It refuses occupied ports, an unmarked existing ledger or a mismatched genesis. It never resets the ledger automatically.

In terminal B:

```bash
npm run dev
```

Open [the protocol 3 entry screen](http://127.0.0.1:4173/?version=3&lang=en). It uses Localnet by default: choose **With agents** or **With friends**. Generated Localnet profiles receive local faucet SOL for transaction fees. These profiles are local test identities, not your wallet keys. Keep the validator running while playing.

The Localnet browser game can submit core actions directly to RPC without the backend. Rooms, authenticated chat, projections and automation use the optional services below.

### Optional backend and PostgreSQL

Install Docker with Compose. Copy the example without overwriting an existing `.env`:

```bash
# Bash; skip this command if you already created .env
cp -n .env.example .env
docker compose up -d --wait postgres
npm run backend:migrate
npm run v3:api
```

On PowerShell, use `Copy-Item .env.example .env` only if `.env` does not already exist. The copied example points at this checkout's separate local RPC and databases.

Start each additional worker in its own terminal as needed:

```bash
npm run v3:indexer
```

```bash
npm run v3:keeper
```

The API listens on **4197**. PostgreSQL is published only on **127.0.0.1:15439**, with a retained Compose volume. The API applies migrations on startup; the explicit migration command makes setup errors visible before starting it. `npm run v3:rebuild` reconstructs the backend projection from retained chain state.

The keeper and fee service are optional. Local generated service signing and fee sponsorship are **disabled by default** in `.env.example`. Starting `npm run v3:sponsor` on **4198** does not enable sponsorship by itself. Enabling either requires deliberately supplied local configuration and funding; neither is needed for the learning game or direct RPC gameplay. Never use real funds for this fixture environment.

The browser discovers the API and fee endpoints on ports 4197 and 4198 for a loopback game origin. If you change the browser port, update `DUSTPACT_ORIGINS` in `.env` and restart the services. Browser-side custom endpoint variables are `VITE_DUSTPACT_V3_API_URL` and `VITE_DUSTPACT_V3_FEE_URL`; Vite reads them from the web app's environment, not the root backend `.env` automatically.

### Optional two-slot test-token mission

Mission escrow is separate from entry. The sponsor funds **20 local test tokens**; two bridge repair jobs can pay **10 each**. No player stake is required. Local tokens have no cash value and are not Circle-issued USDC. `npm run localnet` prepares a new local mint fixture and generated faucet authority under the ignored runtime directory; it reads no user keys.

Before starting the expedition:

1. Open the Localnet caravan lobby and copy your **public seat-owner address** from **Wallet → Profile**.
2. Grant exactly 20 local tokens to that owner's canonical associated token account:

   ```bash
   npm run localnet:tokens -- <public-seat-owner-address>
   ```

   Replace the angle-bracket placeholder with the public address. The helper signs only with its generated local fixture authority, verifies the local genesis/mint and waits for finalization.

3. Return to the wallet/mission panel and explicitly approve the **20 test-token deposit**. The faucet grant alone does not fund the mission. Then review readiness and start the caravan.

For a read-only fixture/balance check:

```bash
npm run localnet:tokens -- --check <public-seat-owner-address>
```

If a submission outcome is unknown, inspect `--check` and the retained faucet journal before trying again. A deliberate new successful grant adds another 20 tokens; it is not a balance reset.

An older ledger without this mint fixture fails closed. Preserve it. To create a separate fresh fixture, first stop only your previous validator on 19809, then use a new runtime name:

```bash
npm run localnet -- --runtime fresh-name
# In another terminal, after readiness:
npm run localnet:tokens -- <public-seat-owner-address> --runtime fresh-name
npm run localnet:tokens -- --check <public-seat-owner-address> --runtime fresh-name
```

This uses `.runtime/localnet-fresh-name`, keeps the previous ledger and does not import its matches or token balances. The same runtime name must be supplied to the faucet helper. Normal Localnet gameplay does not require mission funding.

### Independent recovery

In another terminal:

```bash
npm run recovery:dev
```

Open [the protocol 3 recovery client](http://127.0.0.1:4174/?version=3&lang=en), enter a Match V3 address and use RPC `http://127.0.0.1:19809`. The main game's recovery link includes the match/network context. The recovery client reads the chain independently of the application API.

Reading needs no wallet. A game action needs the seat owner or a still-valid, authorized session signer; permissionless operations still need a signer for fees. Export the private recovery copy from the main game **before** relying on another origin. A recovery copy preserves a hidden choice and send history; it is not a wallet key. Losing the original committed move prevents its reconstruction. Unknown transaction sends are reconciled before fresh signing.

## Ports, storage and stopping

| Component              | Default                 | Retained local state                                 |
| ---------------------- | ----------------------- | ---------------------------------------------------- |
| Game                   | 127.0.0.1:4173          | Browser local identity and private move/send records |
| Recovery               | 127.0.0.1:4174          | Separate origin's imported recovery context          |
| Solana RPC / WebSocket | 127.0.0.1:19809 / 19810 | `.runtime/localnet/ledger`, genesis marker           |
| API                    | 127.0.0.1:4197          | PostgreSQL projections and application data          |
| Optional fee service   | 127.0.0.1:4198          | Explicitly configured local service state            |
| PostgreSQL             | 127.0.0.1:15439         | Docker Compose named volume                          |

Use `Ctrl+C` in each server/worker terminal. `docker compose stop postgres` stops the database while preserving its volume. Restart with the same commands. Do not delete `.runtime`, browser storage or the database volume to fix a connection error: they may contain match state or the only saved hidden choice.

Common setup failures:

- **Node engine error:** check that the active shell uses Node 22.12+.
- **SBF version/hash mismatch:** use the reviewed builder/platform tool versions; keep the release pins intact.
- **Occupied port:** stop only the process you own or choose a documented alternative; the launcher does not take over another validator.
- **Database unavailable:** verify `docker compose ps`, port 15439 and `.env` before migrating.
- **Public signing disabled:** expected without a separately reviewed public release policy. Changing an RPC URL alone is insufficient.
- **Recovery cannot reveal:** it needs the exact saved commitment preimage and an authorized signer; a match address alone cannot restore it.

## Verification limits

The repository includes local rules, SDK, native-program and recovery checks using generated actors. A fresh host's full native stack, two external wallets and a public deployment require their own execution and acceptance checks. The instructions describe the intended portable setup; they do not claim those external acceptance results.

## Кратко по-русски

**Быстрый запуск:** Node.js 22.12+, затем `npm ci` и `npm run demo`. Откройте [обучение](http://127.0.0.1:4173/?version=3&mode=practice&tutorial=0&lang=ru). Это настоящая 3D-игра с локальными правилами Rust/Wasm, но без транзакций и выплат. Кошелёк, Rust, Docker и SOL не нужны.

**Нативный Localnet:** Linux/macOS или WSL. Node, npm, Rust и Solana должны работать в одной среде. Нужны Rust 1.91.0, SBF builder 3.1.10, platform-tools v1.52 и `solana-test-validator`. Выполните `npm run build:programs`, затем `npm run localnet`; во втором терминале — `npm run dev`. RPC работает на 19809, игра — на 4173. Локальные профили сгенерированы, токены не имеют денежной стоимости. Сохранённый ledger не сбрасывается.

**Сервисы:** скопируйте `.env.example` в отсутствующий `.env`, выполните `docker compose up -d --wait postgres`, `npm run backend:migrate`, `npm run v3:api`. При необходимости отдельно запустите `npm run v3:indexer` и `npm run v3:keeper`. PostgreSQL — 15439, API — 4197, необязательный sponsor — 4198. Сервисные подписи и спонсирование по умолчанию выключены.

**Тестовая миссия:** до старта матча скопируйте свой публичный адрес в «Кошелёк → Профиль», выполните `npm run localnet:tokens -- <публичный-адрес>`, затем отдельно подтвердите депозит 20 тестовых токенов в интерфейсе. Команда выдаёт ровно 20 токенов локального fixture; пользовательские ключи не нужны. Проверка без подписи: `npm run localnet:tokens -- --check <публичный-адрес>`. Старый ledger без mint не изменяется автоматически: для отдельной новой сети остановите свой validator и используйте `npm run localnet -- --runtime fresh-name`; тот же `--runtime fresh-name` передавайте команде выдачи токенов.

**Восстановление:** `npm run recovery:dev`, затем [клиент на 4174](http://127.0.0.1:4174/?version=3&lang=ru). Нужны адрес матча, доступный RPC, право подписи и точная сохранённая копия скрытого хода для раскрытия. Копия хода не восстанавливает ключ кошелька.

**Проверки:** `npm run typecheck`, `npm run backend:typecheck`, `npm test`, `npm run build`. Пересборка Wasm: `rustup target add wasm32-unknown-unknown` и `npm run build:wasm`. Публичное развёртывание и внешний multiplayer-путь требуют отдельных проверок.
