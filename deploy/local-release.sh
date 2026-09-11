#!/usr/bin/env bash
set -euo pipefail
umask 077
mode=${1:-build}
windows_first=0
case "$mode" in
  build) ;;
  build-windows) mode=build; windows_first=1 ;;
  publish|auth) ;;
  *) echo 'Usage: deploy/local-release.sh [build|build-windows|publish|auth]' >&2; exit 2 ;;
esac
source_root=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
state=${POP_AGENT_RELEASE_HOME:-"$HOME/.local/share/pop-agent/release-builder"}
[[ "$state" = /* && "$state" != / && ! -L "$state" ]] || { echo 'Use an absolute, owner-only builder directory.' >&2; exit 1; }
mkdir -p "$state"
[[ $(stat -c %u "$state") = $(id -u) && $(stat -c %a "$state") = 700 ]] || { echo 'Builder directory must be owned by this user with mode 700.' >&2; exit 1; }
exec 9>"$state/lock"
flock -n 9 || { echo 'Another local build/publication is active.' >&2; exit 1; }
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then docker_cmd=(sudo -n docker); fi
image="pop-release-builder:$(sha256sum "$source_root/deploy/local-release.Dockerfile" | cut -c1-16)"
if ! "${docker_cmd[@]}" image inspect "$image" >/dev/null 2>&1; then
  "${docker_cmd[@]}" build --tag "$image" --file "$source_root/deploy/local-release.Dockerfile" "$source_root/deploy"
fi
mkdir -p "$state/cache/home" "$state/releases" "$state/auth"
if [[ "$mode" = auth ]]; then
  # Token comes from stdin; only the publisher mounts this separate credential directory.
  "${docker_cmd[@]}" run --rm -i --user "$(id -u):$(id -g)" -e GH_CONFIG_DIR=/auth -v "$state/auth:/auth" "$image" gh auth login --hostname github.com --git-protocol https --with-token
  exit
fi
[[ -z $(git -C "$source_root" status --porcelain) ]] || { echo 'Commit the agreed batch before building or publishing.' >&2; exit 1; }
commit=$(git -C "$source_root" rev-parse HEAD)
if [[ "$mode" = build ]]; then
  [[ $(uname -m) = x86_64 ]] || { echo 'The local builder supports AMD64 only.' >&2; exit 1; }
  if [[ ! -d "$state/checkout/.git" ]]; then git clone --quiet --no-hardlinks "$source_root" "$state/checkout"; fi
  [[ $(git -C "$state/checkout" remote get-url origin) = "$source_root" ]] || { echo 'Unexpected builder checkout origin.' >&2; exit 1; }
  git -C "$state/checkout" fetch --quiet origin "$commit"
  git -C "$state/checkout" checkout --quiet --detach "$commit"
  timeout --kill-after=30s 45m "${docker_cmd[@]}" run --rm --init --cpus=2 --memory=4g --user "$(id -u):$(id -g)"     -e POP_AGENT_BUILDER_IMAGE="$image" -e POP_AGENT_WINDOWS_FIRST_RELEASE="$windows_first" -e HOME=/cache/home     -v "$state/checkout:/work" -v "$state/cache:/cache" -v "$state/releases:/releases"     "$image" bash deploy/local-release-container.sh
else
  [[ -r "$state/releases/latest" ]] || { echo 'Build the batch first.' >&2; exit 1; }
  built=$(cat "$state/releases/latest")
  [[ "$built" = "$commit" ]] || { echo 'Latest build does not match this committed batch.' >&2; exit 1; }
  "${docker_cmd[@]}" run --rm --init --user "$(id -u):$(id -g)"     -e HOME=/auth/home -e GH_CONFIG_DIR=/auth -e EXPECTED_COMMIT="$commit"     -v "$state/auth:/auth" -v "$state/checkout:/work" -v "$state/cache:/cache:ro" -v "$state/releases:/releases:ro"     "$image" /cache/home/.local/share/pop-agent/server-toolchain/current/node/bin/node tools/publish-local-release.ts "/releases/$commit" --publish
fi
