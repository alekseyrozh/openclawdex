-- Backfill: rows that were archived under the old boolean but never
-- got a stamp (pre-0007 archives) need a non-null `archived_at` or
-- they'd silently become active when the column is dropped below.
-- `created_at` is the closest timestamp we have in SQL — `lastModified`
-- lives in the rollout JSONL files, not the DB.
UPDATE `known_threads` SET `archived_at` = `created_at` WHERE `archived` = 1 AND `archived_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `known_threads` DROP COLUMN `archived`;
