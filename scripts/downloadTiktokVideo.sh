#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <tiktok_url>" >&2
  exit 1
fi

yt-dlp \
  --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -o "/var/minis/attachments/%(id)s.%(ext)s" \
  "$1"
