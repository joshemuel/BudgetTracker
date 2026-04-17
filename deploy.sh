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

# build frontend
cd /opt/budgettracker/frontend
npm install --no-audit --no-fund
npm run build
sudo rsync -av --delete dist/ /var/www/budgettracker/

# rebuild backend + run migrations
cd /opt/budgettracker
sudo docker compose -f docker-compose.prod.yml up -d --build db backend
sudo docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head

# reload nginx
sudo nginx -t
sudo systemctl reload nginx

echo "=== Deploy complete ==="
REMOTE
