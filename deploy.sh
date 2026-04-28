#!/usr/bin/env bash
# deploy.sh — one-command deploy for BudgetTracker production
#
# Usage: ./deploy.sh
#
# Prerequisites:
#   - SSH access to EC2 with ~/.ssh/AWSBasicKeyPair.pem
#   - Remote repo cloned at /opt/budgettracker on EC2
#   - Node.js 20+ installed on EC2
#
# What it does:
#   1. Pushes local changes to GitHub
#   2. Pulls changes on EC2
#   3. Builds frontend and syncs to nginx static root
#   4. Rebuilds backend containers and runs migrations
#   5. Reloads nginx

set -euo pipefail

EC2_HOST="ec2-user@13.213.215.251"
EC2_KEY="$HOME/.ssh/AWSBasicKeyPair.pem"
APP_DIR="/opt/budgettracker"

echo "=== Pushing to GitHub ==="
git add -A
git commit -m "${1:-auto deploy}" || true
git push

echo "=== Deploying to EC2 ==="
ssh -i "$EC2_KEY" "$EC2_HOST" bash <<'REMOTE'
set -euxo pipefail
cd /opt/budgettracker

# pull latest code
git pull

# remove stale Python bytecode from the repo tree so it never enters the build context
find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
find . -name '*.pyc' -o -name '*.pyo' | xargs rm -f 2>/dev/null || true

# build frontend
cd /opt/budgettracker/frontend
npm install --no-audit --no-fund
npm run build
sudo rsync -av --delete dist/ /var/www/budgettracker/

# rebuild backend — force fresh image (no stale layers) then recreate the container
cd /opt/budgettracker
sudo docker compose -f docker-compose.prod.yml build --no-cache backend
sudo docker compose -f docker-compose.prod.yml up -d --force-recreate db backend
sudo docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head

# remove dangling images left over from previous builds
sudo docker image prune -f

# reload nginx
sudo nginx -t
sudo systemctl reload nginx

echo "=== Deploy complete ==="
REMOTE
