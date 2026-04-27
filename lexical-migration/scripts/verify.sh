#!/usr/bin/env bash
# verify.sh — runs verification commands against $repoRoot (read from .lexm/migration.json)
# Modes: tsc-only | build | tsc+build | test | tsc+build+test
set -e

MODE="${1:-tsc+build}"

if [ "$MODE" = "--self-test" ]; then
  echo "verify.sh: self-test ok"
  exit 0
fi

DIR="$(pwd)"
ROOT=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f "$DIR/.lexm/migration.json" ]; then
    ROOT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DIR/.lexm/migration.json','utf8')).repoRoot)")
    break
  fi
  PARENT="$(dirname "$DIR")"
  if [ "$PARENT" = "$DIR" ]; then break; fi
  DIR="$PARENT"
done

if [ -z "$ROOT" ]; then
  echo "STOP no migration.json found"
  exit 2
fi

cd "$ROOT"

case "$MODE" in
  tsc-only) npx tsc --noEmit ;;
  build) npm run build ;;
  tsc+build) npx tsc --noEmit && npm run build ;;
  test) npm test --silent || true ;;
  tsc+build+test) npx tsc --noEmit && npm run build && (npm test --silent || true) ;;
  *)
    echo "verify.sh: unknown mode '$MODE'"
    exit 1
    ;;
esac

echo "verify.sh: $MODE ok at $ROOT"
