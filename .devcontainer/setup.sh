#!/usr/bin/env bash
# Runs once when the codespace is created: install, build, create local secrets.
set -euo pipefail
npm ci
npm run build
if [ ! -f .env ]; then
  rnd() { node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"; }
  cat > .env <<ENV
# Created automatically for this codespace. Not committed (see .gitignore).
SESSION_SECRET=$(rnd)
SETUP_TOKEN=$(rnd)
NODE_ENV=production
PORT=3000
UPLOAD_DIR=./data/uploads
BACKUP_DIR=./data/backups
OPENAI_MODEL=gpt-5.5
ENV
fi
