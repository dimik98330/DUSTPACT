# Public web deployment

The free public web origin is https://dimik98330.github.io/DUSTPACT/.
Source repository: https://github.com/dimik98330/DUSTPACT.

The published build uses `npm run build:pages` and serves the 3D learning
expedition, its Rust/Wasm rules, character animations and both interface
languages. The root page selects learning by default. The independent recovery
client is built under `/DUSTPACT/recovery/`; it still requires a configured RPC
and trusted deployment policies before it can operate on public matches.

The static origin does not host PostgreSQL, the Solana validator, rooms/chat,
indexer, keeper or fee sponsorship. Public multiplayer, external wallet
transactions and test-token escrow are not enabled by this deployment. The
existing local chain and retained matches are unchanged. Learning is explicitly
offchain and has no wallet, real funds or token payouts.

The isolated publication checkout is `.runtime/public-hosting`. Its GitHub
Actions workflow rebuilds and publishes the exact pushed `main` commit. Runtime
data, ledger state, secrets and private keys are excluded. The build writes
`deployment.json` with its source commit and the explicit offchain mode.

For another static origin, set `DUSTPACT_BASE_PATH=/` before `npm run build:pages`.
The default base is `/DUSTPACT/`. Serve `apps/web/dist` over HTTPS. A Vercel
deployment would use the same build command, output directory and base override;
it still needs a separate public chain and services for multiplayer.
