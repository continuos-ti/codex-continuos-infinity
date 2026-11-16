#!/bin/sh
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  echo "Linux build dependency preparation must run on Linux" >&2
  exit 1
fi

install_dependencies() {
  timeout 60s sudo apt-get \
    -o APT::Update::Error-Mode=any \
    -o Acquire::ForceIPv4=true \
    -o Acquire::Retries=0 \
    -o Acquire::http::Timeout=15 \
    -o Acquire::https::Timeout=15 update &&
  timeout 90s sudo apt-get \
    -o Acquire::ForceIPv4=true \
    -o Acquire::Retries=0 \
    -o Acquire::http::Timeout=15 \
    -o Acquire::https::Timeout=15 \
    install -y meson ninja-build pkg-config libglib2.0-dev libgdk-pixbuf-2.0-dev binutils
}

# GitHub's Ubuntu 24.04 amd64 runner uses an apt mirror list. A successful
# InRelease HEAD request does not establish that package downloads will work.
# Retry the complete apt transaction against the next mirror on failure.
# apt continues to verify repository signatures and package hashes.
if [ -f /etc/apt/apt-mirrors.txt ] && [ "$(dpkg --print-architecture)" = "amd64" ]; then
  original_mirrors="$(cat /etc/apt/apt-mirrors.txt)"
  installed=false
  for mirror in \
    "https://mirrors.kernel.org/ubuntu" \
    "https://mirror.math.princeton.edu/pub/ubuntu" \
    "https://mirrors.ocf.berkeley.edu/ubuntu" \
    "https://archive.ubuntu.com/ubuntu"; do
    if ! curl -fsSI --connect-timeout 6 --max-time 15 \
      "$mirror/dists/noble/InRelease" >/dev/null 2>&1; then
      echo "Ubuntu apt mirror not reachable: $mirror" >&2
      continue
    fi
    printf '%s\n' "$mirror" | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
    echo "Attempting signed Ubuntu apt mirror: $mirror"
    if install_dependencies; then
      installed=true
      break
    fi
    echo "Ubuntu apt transaction failed on $mirror; trying another mirror" >&2
  done
  if [ "$installed" != true ]; then
    printf '%s\n' "$original_mirrors" | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
    echo "No Ubuntu 24.04 mirror completed the libnotify dependency installation" >&2
    exit 1
  fi
else
  install_dependencies
fi
