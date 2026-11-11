#!/bin/sh
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  echo "Linux build dependency preparation must run on Linux" >&2
  exit 1
fi

# GitHub's Ubuntu 24.04 amd64 runner uses an apt mirror list. Some runners
# cannot resolve archive.ubuntu.com even while other HTTPS endpoints work.
# Ubuntu still verifies the repository's signed Release metadata and packages.
if [ -f /etc/apt/apt-mirrors.txt ] && [ "$(dpkg --print-architecture)" = "amd64" ]; then
  selected_mirror=""
  for mirror in \
    "https://mirrors.kernel.org/ubuntu" \
    "https://mirror.math.princeton.edu/pub/ubuntu" \
    "https://mirrors.ocf.berkeley.edu/ubuntu" \
    "https://archive.ubuntu.com/ubuntu"; do
    if curl -fsSI --connect-timeout 6 --max-time 15 \
      "$mirror/dists/noble/InRelease" >/dev/null 2>&1; then
      selected_mirror="$mirror"
      break
    fi
  done
  if [ -z "$selected_mirror" ]; then
    echo "No reachable Ubuntu 24.04 apt mirror; cannot prepare libnotify build" >&2
    exit 1
  fi
  printf '%s\n' "$selected_mirror" | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
  echo "Selected signed Ubuntu apt mirror: $selected_mirror"
fi

timeout 180s sudo apt-get \
  -o APT::Update::Error-Mode=any \
  -o Acquire::Retries=0 \
  -o Acquire::http::Timeout=15 \
  -o Acquire::https::Timeout=15 update

timeout 180s sudo apt-get \
  -o Acquire::Retries=0 \
  -o Acquire::http::Timeout=15 \
  -o Acquire::https::Timeout=15 \
  install -y meson ninja-build pkg-config libglib2.0-dev libgdk-pixbuf-2.0-dev binutils
