#!/usr/bin/env bash
# Starts a clean test instance: fresh test database, mock OpenAI, built app on port 3100.
set -euo pipefail
export DATABASE_URL="${TEST_DATABASE_URL:-postgres://copywrite:copywrite@localhost:5432/copywrite_test}"
PGOPTIONS="--client-min-messages=warning" psql "$DATABASE_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
rm -rf ./data/test-uploads ./data/test-backups
node tests/e2e/mock-openai.mjs &
export PORT=3100 SESSION_SECRET=test-secret UPLOAD_DIR=./data/test-uploads BACKUP_DIR=./data/test-backups BACKUP_ENABLED=false NODE_ENV=test \
  OPENAI_API_KEY=test-key-not-real OPENAI_BASE_URL=http://localhost:3199/v1 OPENAI_MODEL=gpt-test PUBLIC_URL=http://localhost:3100
exec node dist/server.js
