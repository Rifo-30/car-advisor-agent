#!/usr/bin/env bash
# ============================================================
# 本地一键启动 PostgreSQL(14 + pgvector) + Redis，并写入种子数据
# 用法：bash scripts/local-db.sh
# 说明：需要在你自己的终端（Terminal / iTerm）运行，
#      不要在 Codex 沙箱里运行（沙箱会拦截 shmget）。
# ============================================================
set -euo pipefail

PG_BIN=/usr/local/opt/postgresql@14/bin
PGDATA=/usr/local/var/postgres14
PGLOG=/usr/local/var/postgres14.log
REDIS_BIN=/usr/local/opt/redis/bin
REDIS_DIR=/usr/local/var/redis
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_NAME=car_advisor

step() { printf "\n\033[1;34m==> %s\033[0m\n" "$1"; }

# ---------- 1. 检查二进制 ----------
step "检查 Postgres / Redis / pgvector"
for bin in "$PG_BIN/initdb" "$PG_BIN/pg_ctl" "$PG_BIN/psql" "$REDIS_BIN/redis-server"; do
  [ -x "$bin" ] || { echo "❌ 缺少 $bin"; exit 1; }
done
[ -f /usr/local/Cellar/postgresql@14/14.18/lib/postgresql@14/vector.so ] || {
  echo "❌ 缺少 pgvector 扩展（vector.so）"; exit 1;
}
echo "✅ 二进制齐全"

# ---------- 2. 初始化数据目录 ----------
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  step "初始化 PostgreSQL 数据目录（首次运行）"
  mkdir -p "$PGDATA"
  "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8
else
  echo "✅ 数据目录已存在：$PGDATA"
fi

# ---------- 3. 启动 Postgres ----------
if "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "✅ PostgreSQL 已在运行"
else
  step "启动 PostgreSQL（端口 5432）"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -o "-p 5432" -w start
fi

# ---------- 4. 建库 + pgvector 扩展 ----------
if ! "$PG_BIN/psql" -U postgres -h 127.0.0.1 -p 5432 -tAc \
     "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  step "创建数据库 $DB_NAME"
  "$PG_BIN/createdb" -U postgres -h 127.0.0.1 -p 5432 "$DB_NAME"
fi

step "启用 pgvector 扩展"
"$PG_BIN/psql" -U postgres -h 127.0.0.1 -p 5432 -d "$DB_NAME" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"

# ---------- 5. 启动 Redis ----------
if "$REDIS_BIN/redis-cli" -p 6379 ping >/dev/null 2>&1; then
  echo "✅ Redis 已在运行"
else
  step "启动 Redis（端口 6379）"
  mkdir -p "$REDIS_DIR"
  "$REDIS_BIN/redis-server" --port 6379 --daemonize yes \
    --dir "$REDIS_DIR" --logfile "$REDIS_DIR/redis.log"
  sleep 1
  "$REDIS_BIN/redis-cli" -p 6379 ping >/dev/null
fi

# ---------- 6. 写入种子数据 ----------
step "写入种子数据（车型 / 配置 / 评测）"
cd "$ROOT"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/$DB_NAME" \
REDIS_URL="redis://127.0.0.1:6379" \
pnpm db:seed

# ---------- 7. 验证 ----------
step "验证数据"
"$PG_BIN/psql" -U postgres -h 127.0.0.1 -p 5432 -d "$DB_NAME" -c \
  "SELECT (SELECT count(*) FROM car_models)   AS car_models,
          (SELECT count(*) FROM car_variants) AS car_variants,
          (SELECT count(*) FROM car_reviews)  AS car_reviews;"

"$PG_BIN/psql" -U postgres -h 127.0.0.1 -p 5432 -d "$DB_NAME" -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"

echo
echo "🎉 完成！现在运行 pnpm dev，然后访问 http://localhost:3000/api/health"
echo "   应该看到 dataMode=postgres、cacheMode=redis"
