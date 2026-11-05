-- 清理 30 天未更新的会话检查点（生产定时任务用）
-- 用法：psql "$DATABASE_URL" -f scripts/clear-checkpoints.sql
BEGIN;

CREATE TEMP TABLE stale_threads AS
SELECT thread_id
FROM checkpoints
GROUP BY thread_id
HAVING max((checkpoint->>'ts')::timestamptz) < now() - interval '30 days';

DELETE FROM checkpoint_writes WHERE thread_id IN (SELECT thread_id FROM stale_threads);
DELETE FROM checkpoint_blobs  WHERE thread_id IN (SELECT thread_id FROM stale_threads);
DELETE FROM checkpoints       WHERE thread_id IN (SELECT thread_id FROM stale_threads);

COMMIT;
