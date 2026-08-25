#!/usr/bin/env bash
# Dispatches to a single backend service's smoke test. Each service's smoke test must
# assert its actual job, not just that the process started — see
# ibms-brain/meta/context/verification-contract.md § Backend services additionally.
#
# Usage: bash scripts/smoke.sh <service>
#   bash scripts/smoke.sh api
#
# Loads .env.test (the db-test / CI test database — never the dev DB) if present, so
# this also works standalone from a fresh shell, not just via an npm/turbo script.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f .env.test ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.test
  set +a
fi

SERVICE="${1:-}"

case "$SERVICE" in
  api)
    exec bash apps/api/scripts/smoke.sh
    ;;
  *)
    echo "usage: bash scripts/smoke.sh <service>" >&2
    echo "known services: api" >&2
    echo "(only one backend service exists today — add a case here the day a second one does)" >&2
    exit 1
    ;;
esac
