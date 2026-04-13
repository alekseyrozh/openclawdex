CREATE TABLE `project_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`folder_path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `known_threads` ADD `project_id` text;