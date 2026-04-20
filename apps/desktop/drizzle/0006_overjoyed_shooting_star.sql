ALTER TABLE `known_threads` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `sort_order` = `created_at`;--> statement-breakpoint
UPDATE `known_threads` SET `sort_order` = `created_at`;