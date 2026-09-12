CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `character_bibles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`canonical_name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `character_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`label` text NOT NULL,
	`prompt_anchor` text DEFAULT '' NOT NULL,
	`immutable_traits` text DEFAULT '' NOT NULL,
	`allowed_variations` text DEFAULT '' NOT NULL,
	`forbidden_variations` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`season_number` integer DEFAULT 1 NOT NULL,
	`episode_number` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `location_bibles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `location_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`label` text NOT NULL,
	`prompt_anchor` text DEFAULT '' NOT NULL,
	`immutable_features` text DEFAULT '' NOT NULL,
	`allowed_variations` text DEFAULT '' NOT NULL,
	`forbidden_variations` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `production_scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`scene_number` integer NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `series_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`budget_mode` text DEFAULT 'BALANCED' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shots` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`shot_number` integer NOT NULL,
	`specification` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`quality_target` text DEFAULT 'STANDARD' NOT NULL,
	`preferred_provider` text,
	`approved_take_id` text
);
--> statement-breakpoint
CREATE TABLE `style_bibles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`visual_style` text NOT NULL,
	`negative_constraints` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `takes` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`reference_assets` text DEFAULT '[]' NOT NULL,
	`output_asset_id` text,
	`final_frame_asset_id` text,
	`rejection_reasons` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`estimated_cost` text,
	`actual_cost` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
