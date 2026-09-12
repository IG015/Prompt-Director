CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`mode` text,
	`actions` text DEFAULT '[]' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`provider` text,
	`model` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_messages_thread_created` ON `assistant_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`scene_id` text,
	`shot_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_threads_project_owner_updated` ON `assistant_threads` (`project_id`,`owner_id`,`updated_at`);--> statement-breakpoint
PRAGMA optimize;
