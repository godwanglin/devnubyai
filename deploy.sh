#!/bin/bash
set -e

# Export Node.js & NPM binary paths if installed via aaPanel or system
if [ -d "/www/server/nodejs/v24.14.1/bin" ]; then
    export PATH="/www/server/nodejs/v24.14.1/bin:$PATH"
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "========================================="
echo " Deploying Devnuby AI on VPS"
echo " Directory: $APP_DIR"
echo " Port: 6752"
echo " Time: $(date)"
echo "========================================="

# 1. Ensure .env and DEPLOY_RULE.md are preserved
mkdir -p .git/info
grep -qxF ".env" .git/info/exclude 2>/dev/null || printf "\n.env\n" >> .git/info/exclude
grep -qxF "DEPLOY_RULE.md" .git/info/exclude 2>/dev/null || printf "DEPLOY_RULE.md\n" >> .git/info/exclude

# Backup config/network-rules.json if it exists to preserve dynamic changes
if [ -f "config/network-rules.json" ]; then
    cp config/network-rules.json /tmp/network-rules-deploy.bak
fi

# 2. Sync latest code from GitHub
echo "[1/6] Fetching latest changes from GitHub..."
git remote set-url origin https://github.com/godwanglin/devnubyai.git
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e DEPLOY_RULE.md

if [ -f "/tmp/network-rules-deploy.bak" ]; then
    echo "Restoring dynamic network rules config..."
    cp /tmp/network-rules-deploy.bak config/network-rules.json
fi

# 3. Install dependencies
echo "[2/6] Installing dependencies..."
if [ -f package-lock.json ]; then
    npm ci --include=dev || npm install --include=dev
else
    npm install --include=dev
fi

# 4. Generate Prisma Client & Sync DB
echo "[3/6] Generating Prisma client & syncing database..."
npx prisma generate
npx prisma db push

# 5. Build Next.js application
echo "[4/6] Building Next.js production bundle..."
npm run build

# 6. PM2 Process Management
echo "[5/6] Starting / Reloading PM2 process..."
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
fi

if pm2 describe "devnuby-ai" >/dev/null 2>&1; then
    echo "Reloading existing devnuby-ai process..."
    pm2 restart ecosystem.config.cjs --update-env
else
    echo "Starting new devnuby-ai PM2 process..."
    pm2 start ecosystem.config.cjs
fi

pm2 save

# 7. Verification
echo "[6/6] Verifying service health..."
sleep 3

if curl -s -f -o /dev/null "http://127.0.0.1:6752/"; then
    echo "SUCCESS: Devnuby AI is responding on http://127.0.0.1:6752/!"
else
    echo "WARNING: Local port check did not return 200 OK immediately. Checking PM2 status..."
fi

pm2 describe devnuby-ai

echo "========================================="
echo " Deployment completed successfully!"
echo " Public URL: https://chat.devnuby.id"
echo "========================================="
