#!/bin/bash
set -e

echo "=== DEPLOY START ==="

echo "→ Fetch from GitHub"
git fetch origin

echo "→ Reset to origin/main"
git reset --hard origin/main

echo "→ Install dependencies"
npm install

echo "→ Restart server"
pm2 delete mafia-server || true
pm2 start server.js --name mafia-server

echo "=== DEPLOY DONE ==="

