#!/usr/bin/env bash
set -euo pipefail

REPO="dworthen/ghd"
VERSION="latest"
TO="$HOME/.ghd/bin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if ! command -v gh &>/dev/null; then
  echo "Error: gh CLI is required but not found. Install it from https://cli.github.com/ then run 'gh auth login' to authenticate with EMU account." >&2
  exit 1
fi

if ! command -v tar &>/dev/null; then
  echo "Error: tar is required but not found." >&2
  exit 1
fi

get_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)
      case "$arch" in
        x86_64)  echo "linux-x64" ;;
        aarch64) echo "linux-arm64" ;;
        *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
      esac
      ;;
    Darwin)
      case "$arch" in
        x86_64) echo "darwin-x64" ;;
        arm64)  echo "darwin-arm64" ;;
        *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
      esac
      ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac
}

resolve_tag() {
  local tag="$VERSION"
  if [[ "$tag" == "latest" ]]; then
    tag="$(gh release view --repo "$REPO" --json tagName --jq '.tagName' 2>/dev/null || true)"
    if [[ -z "$tag" || "$tag" == "null" || "$tag" == "{"* ]]; then
      echo "Error: Could not resolve latest release tag for $REPO" >&2
      exit 1
    fi
  fi
  echo "$tag"
}

download_binary() {
  local platform="$1" tag="$2"
  local asset="${platform}.tar.gz"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap "rm -rf '$tmpdir'" EXIT

  echo "Downloading $asset ..."
  if ! gh release download "$tag" --repo "$REPO" --pattern "$asset" --dir "$tmpdir" --clobber 2>/dev/null; then
    echo "Error: Failed to download $asset" >&2
    exit 1
  fi

  local archive="$tmpdir/$asset"
  if [[ ! -f "$archive" ]]; then
    echo "Error: Download produced no file" >&2
    exit 1
  fi

  echo "Extracting ..."
  tar -xzf "$archive" -C "$tmpdir"

  local exe
  exe="$(find "$tmpdir" -name "ghd" -type f | head -n 1)"
  if [[ -z "$exe" ]]; then
    echo "Error: ghd binary not found inside $asset" >&2
    exit 1
  fi

  chmod +x "$exe"
  mkdir -p "$TO"
  mv -f "$exe" "$TO/ghd"
  echo "ghd installed to $TO"
}

add_to_path() {
  local bin_dir
  bin_dir="$(cd "$TO" && pwd)"

  if echo "$PATH" | tr ':' '\n' | grep -qx "$bin_dir"; then
    echo "$bin_dir is already in PATH."
    return
  fi

  local shell_config=""
  case "${SHELL:-}" in
    *zsh)  shell_config="$HOME/.zshrc" ;;
    *bash) shell_config="$HOME/.bashrc" ;;
    *)     shell_config="$HOME/.profile" ;;
  esac

  echo "" >> "$shell_config"
  echo "export PATH=\"$bin_dir:\$PATH\"" >> "$shell_config"
  export PATH="$bin_dir:$PATH"
  echo "Added $bin_dir to PATH in $shell_config"
}

PLATFORM="$(get_platform)"
TAG="$(resolve_tag)"
echo "Detected platform: $PLATFORM"
echo "Resolved version to download: $TAG"

download_binary "$PLATFORM" "$TAG"
add_to_path

echo "ghd installed successfully! You can run 'ghd --help' to get started."
