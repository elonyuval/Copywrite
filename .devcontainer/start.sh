#!/usr/bin/env bash
# Runs every time the codespace starts: wait for Postgres, then start the app in the background.
set -uo pipefail
mkdir -p data
for i in $(seq 1 60); do
  node -e "const s=require('net').connect(5432,'db',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" && break
  sleep 1
done
if ! curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
  setsid nohup npm start >> data/server.log 2>&1 < /dev/null &
fi
