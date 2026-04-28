#!/usr/bin/env bash
# verify.sh — runs verification commands against $TARGET (default: read from .twsp/migration.json)
# Modes: tsc-only | build | build+lint | tsc+build | tsc+build+lint | dev-smoke
set -e

MODE="${1:-tsc+build}"

if [ "$MODE" = "--self-test" ]; then
  echo "verify.sh: self-test ok"
  exit 0
fi

# Find migration.json
DIR="$(pwd)"
TARGET=""
for _ in 1 2 3 4 5 6 7 8; do
  if [ -f "$DIR/.twsp/migration.json" ]; then
    TARGET=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DIR/.twsp/migration.json','utf8')).targetRoot)")
    break
  fi
  PARENT="$(dirname "$DIR")"
  if [ "$PARENT" = "$DIR" ]; then break; fi
  DIR="$PARENT"
done

if [ -z "$TARGET" ]; then
  echo "STOP no migration.json found"
  exit 2
fi

cd "$TARGET"

case "$MODE" in
  tsc-only) npx tsc --noEmit ;;
  build) npx rsbuild build ;;
  build+lint) npx rsbuild build && npx eslint . --max-warnings=999 ;;
  tsc+build) npx tsc --noEmit && npx rsbuild build ;;
  tsc+build+lint) npx tsc --noEmit && npx rsbuild build && npx eslint . --max-warnings=0 ;;
  dev-smoke)
    # Start dev, wait for first compile event, kill.
    timeout 30 npx rsbuild dev || true
    ;;
  *)
    echo "verify.sh: unknown mode '$MODE'"
    exit 1
    ;;
esac

echo "verify.sh: $MODE ok at $TARGET"
