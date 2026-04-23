ALTER TABLE `known_threads` ADD `pin_sort_order` integer;--> statement-breakpoint
-- Backfill a non-null `pin_sort_order` for every row that's currently pinned,
-- so the "pinned iff pin_sort_order IS NOT NULL" invariant holds from the
-- moment this migration runs. Uses `-created_at` because we don't know the
-- historical pin time: newer threads get a more-negative value and sort
-- higher in the pinned section, consistent with the `-Date.now()` convention
-- the new pin handler uses. Each row gets a distinct value as long as no two
-- were created in the same ms.
UPDATE `known_threads` SET `pin_sort_order` = -`created_at` WHERE `pinned` = 1;
