#!/usr/bin/env bash
set -euo pipefail
unset NODE_ENV
umask 077
commit=$(git rev-parse HEAD)
output=/releases/$commit
mkdir -p "$HOME" /cache/audio "$output"
# A container-private tmpfs-like directory is discarded on exit, including fixture leftovers.
export TMPDIR
TMPDIR=$(mktemp -d /tmp/pop-release.XXXXXX)
trap 'rm -rf -- "$TMPDIR"' EXIT
./deploy/bootstrap-server.sh --prepare-only --build-from-source
export PATH="$HOME/.local/share/pop-agent/server-toolchain/current/node/bin:$HOME/.local/share/pop-agent/server-toolchain/current/go/bin:$PATH"
export POP_AGENT_BUILD_CACHE=/cache/audio
if [[ ${POP_AGENT_WINDOWS_FIRST_RELEASE:-0} = 1 ]]; then
  unset POP_AGENT_MACOS_TRAY_DIR
  echo 'Windows-first release: macOS Pop Local Access artifacts are intentionally omitted. A later macOS release requires a new version.'
else
  export POP_AGENT_MACOS_TRAY_DIR="/cache/macos-tray/$commit"
  # Default releases fail before the full gate if the exact native Mac stage has not been supplied.
  node tools/macos-tray-artifacts.ts check "$POP_AGENT_MACOS_TRAY_DIR"
fi
# This cache belongs to one immutable Ubuntu builder image and locked dependency tree.
dependency_key=$(node tools/local-release-cache.ts)
if [[ ! -d node_modules || ! -f /cache/dependency-key || $(cat /cache/dependency-key) != "$dependency_key" ]]; then
  rm -f /cache/dependency-key
  ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --no-audit --no-fund
  printf '%s' "$dependency_key" > /cache/dependency-key
fi
# A successful exact-tree gate is reusable for 24 hours; changed trees always run it.
if ! node --input-type=module -e '
import {readFileSync} from "node:fs";import{execFileSync}from"node:child_process";
try{const receipt=JSON.parse(readFileSync(".git/pop-agent-gate-receipt.json"));const tree=execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();if(receipt.tree!==tree||receipt.node!==process.version||Date.now()-Date.parse(receipt.completedAt)>86400000||!Number.isFinite(Date.parse(receipt.completedAt)))process.exit(1);}catch{process.exit(1)}'; then
  npm run gate
else
  echo 'Reusing the successful gate for this exact committed tree.'
fi
version=$(cat VERSION)
if [[ -f "$output/verified.json" && -f "$output/pop-agent-$version-linux-amd64.tar.gz" ]]; then
  node tools/publish-local-release.ts "$output" --check
  printf '%s' "$commit" > /releases/latest
  echo "Verified bundle already available: $output"
  exit
fi
# Native audio cache is keyed by its build/verification inputs, toolchain and base image.
audio_key=$(cat tools/build-audio-runtime.ts tools/audio-runtime.ts tools/smoke-audio.ts server/src/infrastructure/voice/whisper-transcriber.ts deploy/server-toolchain-manifest.tsv | sha256sum | cut -d' ' -f1)-$POP_AGENT_BUILDER_IMAGE
audio_cache=/cache/audio/builds/$audio_key
if [[ -f "$audio_cache/SHA256SUMS" ]] && (cd "$audio_cache" && sha256sum --check --quiet SHA256SUMS); then
  mkdir -p server/dist/audio
  cp -a "$audio_cache/bundle/." server/dist/audio/
  cp "$audio_cache"/ffmpeg-*.tar.xz "$output/"
  echo 'Reusing the verified minimal FFmpeg build and audio test proof.'
else
  npm run build:audio -- "$output"
  npm run test:audio
  mkdir -p "$audio_cache/bundle"
  cp -a server/dist/audio/. "$audio_cache/bundle/"
  cp "$output"/ffmpeg-*.tar.xz "$audio_cache/"
  (cd "$audio_cache" && find bundle -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS && sha256sum ffmpeg-*.tar.xz >> SHA256SUMS)
fi
npm run pack:cli
npm run pack:server-runtime -- "$output"
# Validate the actual production installation without exposing the host service or data.
mkdir -p "$TMPDIR/no-build-tools"
for tool in npm npx go python python3 gcc g++ make; do
  printf '#!/bin/sh\necho "Unexpected development tool" >&2\nexit 90\n' > "$TMPDIR/no-build-tools/$tool"
  chmod +x "$TMPDIR/no-build-tools/$tool"
done
PATH="$TMPDIR/no-build-tools:$PATH" POP_AGENT_SERVER_RELEASE_DIR="$output" node tools/install-prebuilt.ts --verify-only --data-dir "$TMPDIR/probe-data" --workspace "$TMPDIR/probe-workspace"
node --input-type=module -e 'import{writeFileSync}from"node:fs";writeFileSync(process.argv[1],JSON.stringify({commit:process.argv[2],image:process.env.POP_AGENT_BUILDER_IMAGE,verifiedAt:new Date().toISOString()}));' "$output/verified.json" "$commit"
node tools/publish-local-release.ts "$output" --check
printf '%s' "$commit" > /releases/latest
echo "Ready to publish: $output"
