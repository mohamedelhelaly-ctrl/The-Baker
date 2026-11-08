#!/bin/sh
# Self-migrating, safe to rerun on every restart.
set -e

echo "Applying migrations..."
tries=0
until alembic upgrade head; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then echo "Database never became ready"; exit 1; fi
  echo "Database not ready, retrying ($tries/30)..."
  sleep 2
done

# Optional steps must never block startup.
python -m scripts.seed_owner || echo "WARNING: owner seed failed (non-fatal)"

if [ "$SEED_DEMO" = "true" ]; then
  python -m scripts.seed_demo || echo "WARNING: demo seed failed (non-fatal)"
fi

# Railway sets PORT; --proxy-headers makes rate limiting see the real client IP.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" \
  --proxy-headers --forwarded-allow-ips="*"
