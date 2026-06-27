#!/usr/bin/env bash
# Start the bio-authN live demo (backend + frontend).
# Run from the repo root: bash live/start.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== bio-authN live demo ==="
echo ""

# Backend
echo "[1/2] Starting FastAPI backend on http://localhost:8000 ..."
PYTHONPATH="$REPO_ROOT" uvicorn live.backend.main:app --reload --port 8000 &
BACKEND_PID=$!

# Frontend — install deps if needed
cd "$REPO_ROOT/live/frontend"
if [ ! -d node_modules ]; then
  echo "[2/2] Installing frontend dependencies ..."
  npm install
fi

echo "[2/2] Starting Vite dev server on http://localhost:5173 ..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000       (API)"
echo "  Frontend: http://localhost:5173       (UI)"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl-C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
