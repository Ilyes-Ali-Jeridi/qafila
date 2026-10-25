#!/usr/bin/env bash
# Deploys main to the EC2 API box: pull, install, migrate, restart. Run from any machine with the key.
# Usage: deploy/deploy-api.sh [branch]
set -euo pipefail
HOST=${QAFILA_API_HOST:-52.17.165.123}
KEY=${QAFILA_API_KEY:-$HOME/.ssh/qafila-api.pem}
BRANCH=${1:-main}
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new ubuntu@"$HOST" bash -s "$BRANCH" <<'REMOTE'
set -euo pipefail
BRANCH=$1
cd /opt/qafila/repo
git fetch -q origin "$BRANCH" && git checkout -q "$BRANCH" && git reset -q --hard "origin/$BRANCH"
CI=1 pnpm install --frozen-lockfile --reporter=silent
set -a; . /opt/qafila/.env; set +a
if [ -n "${DATABASE_URL:-}" ]; then pnpm --filter ./services/api db:migrate; fi
sudo cp deploy/qafila-api.service /etc/systemd/system/qafila-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now qafila-api
sudo systemctl restart qafila-api
sleep 3
curl -sf localhost:8787/health | head -c 400; echo
git log --oneline | head -1
REMOTE
