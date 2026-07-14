#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace="$(cd "$script_dir/../.." && pwd)"
source_root="$workspace/skills"
destination_root="${CODEX_HOME:-$HOME/.codex}/skills"
mode="${1:-check}"

usage() {
  echo "Usage: $0 check|install"
  echo "  check    validate canonical packages and compare installed copies"
  echo "  install  install missing packages; refuse to overwrite drifted copies"
}

if [[ "$mode" != "check" && "$mode" != "install" ]]; then
  usage
  exit 64
fi

ruby "$script_dir/validate_openpencil_skills.rb"

shopt -s nullglob
skill_dirs=("$source_root"/openpencil-*)
if [[ ${#skill_dirs[@]} -eq 0 ]]; then
  echo "FAIL: no canonical OpenPencil skills under $source_root" >&2
  exit 1
fi

status=0
for source_dir in "${skill_dirs[@]}"; do
  [[ -d "$source_dir" ]] || continue
  name="$(basename "$source_dir")"
  target="$destination_root/$name"

  if [[ -d "$target" ]]; then
    if diff -qr "$source_dir" "$target" >/dev/null; then
      echo "OK: $name is installed and synchronized"
    else
      echo "DRIFT: $target differs from canonical $source_dir" >&2
      status=2
    fi
    continue
  fi

  if [[ "$mode" == "check" ]]; then
    echo "MISSING: $target"
    status=2
    continue
  fi

  mkdir -p "$destination_root"
  staging="$(mktemp -d "$destination_root/.${name}.install.XXXXXX")"
  cleanup() { rm -rf "$staging"; }
  trap cleanup EXIT
  cp -R "$source_dir/." "$staging/"
  mv "$staging" "$target"
  trap - EXIT
  echo "INSTALLED: $target"
done

exit "$status"
