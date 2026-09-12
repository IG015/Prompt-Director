CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`shot_id` text NOT NULL,
	`take_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_job_id` text,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`generation_package` text NOT NULL,
	`output_url` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_generations_shot_created` ON `generations` (`shot_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `remote_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`local_asset_id` text NOT NULL,
	`remote_id` text,
	`remote_url` text,
	`checksum` text,
	`created_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_remote_assets_provider_local` ON `remote_assets` (`provider`,`local_asset_id`);