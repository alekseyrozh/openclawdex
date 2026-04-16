PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_known_threads` (
	`session_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`project_id` text,
	`custom_name` text,
	`context_stats` text,
	`pinned` integer DEFAULT false,
	`archived` integer DEFAULT false
);
--> statement-breakpoint
INSERT INTO `__new_known_threads`("session_id", "created_at", "project_id", "custom_name", "context_stats", "pinned", "archived") SELECT "session_id", "created_at", "project_id", "custom_name", "context_stats", "pinned", "archived" FROM `known_threads`;--> statement-breakpoint
DROP TABLE `known_threads`;--> statement-breakpoint
ALTER TABLE `__new_known_threads` RENAME TO `known_threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;