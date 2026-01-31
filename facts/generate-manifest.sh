#!/bin/bash
# Regenerates manifest.json from all state JSON files in this folder
# Run this after adding or updating any state fact files

cd "$(dirname "$0")"

# Write to manifest.json directly
{
  echo "{"
  first=true
  for f in *.json; do
    if [ "$f" != "manifest.json" ]; then
      state="${f%.json}"
      checksum=$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)
      if [ "$first" = true ]; then
        first=false
        printf '  "%s": "%s"' "$state" "$checksum"
      else
        printf ',\n  "%s": "%s"' "$state" "$checksum"
      fi
    fi
  done
  echo ""
  echo "}"
} > manifest.json

echo "manifest.json updated with checksums for $(ls -1 *.json | grep -v manifest.json | wc -l | tr -d ' ') state files"
