#!/usr/bin/env bash
# Linux/macOS/WSL native Solana build. Uses only tools already installed on PATH.
set -euo pipefail
workspace="$(cd "$(dirname "$0")/.." && pwd)"
cd "$workspace"
mode="${1:-v3}"
[[ "$mode" == all || "$mode" == v3 ]] || { echo 'Usage: build-programs.sh [all|v3]' >&2; exit 2; }
command -v cargo >/dev/null || { echo 'Install Rust and put cargo on PATH.' >&2; exit 2; }
command -v cargo-build-sbf >/dev/null || { echo 'Install the Solana/Agave SBF toolchain and put cargo-build-sbf on PATH.' >&2; exit 2; }
cargo --version
rustc --version
builder_version="$(cargo build-sbf --version)"
printf '%s\n' "$builder_version"
[[ "$builder_version" == *'solana-cargo-build-sbf 3.1.10'* ]] || { echo 'Reviewed native artifacts require cargo-build-sbf 3.1.10 with platform-tools v1.52; no pins were changed.' >&2; exit 2; }
mkdir -p target/v3-deploy
for program in game-v3 pact-vault-v3; do
  cargo build-sbf --tools-version v1.52 --jobs 2 --manifest-path "programs/$program/Cargo.toml" --sbf-out-dir "$workspace/target/v3-deploy" -- --locked
done
if [[ "$mode" == all ]]; then
  mkdir -p target/v2-deploy
  for program in game-v2 pact-vault; do
    cargo build-sbf --tools-version v1.52 --jobs 2 --manifest-path "programs/$program/Cargo.toml" --sbf-out-dir "$workspace/target/v2-deploy" -- --locked
  done
fi
node scripts/verify-programs.mjs "$mode"
