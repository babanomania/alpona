#!/bin/sh
# Container boot: bring the dataset up on the Supabase Postgres, then serve.
# ALPONA_DATASET picks the pack (supply-chain | ecommerce | saas-metrics).
set -e
cd /app

DATASET="${ALPONA_DATASET:-supply-chain}"
DIR="datasets/${DATASET}/db"
CLI=packages/alpona-cli/src/cli.ts
echo "◈ dataset: ${DATASET}"

echo "◈ preparing dataset against $ALPONA_DB_ADMIN"
pnpm exec tsx "$CLI" migrate --dir "$DIR" --db "$ALPONA_DB_ADMIN"
pnpm exec tsx "$CLI" seed --dir "$DIR" --db "$ALPONA_DB_ADMIN"
pnpm exec tsx "$CLI" marts --dir "$DIR" --db "$ALPONA_DB_ADMIN"
pnpm exec tsx "$CLI" dictionary --dir "$DIR" --db "$ALPONA_DB_ADMIN"

exec pnpm exec tsx packages/server/src/main.ts
