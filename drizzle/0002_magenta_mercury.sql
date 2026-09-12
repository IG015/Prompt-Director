CREATE INDEX `idx_assets_owner` ON `assets` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_character_bibles_project_id` ON `character_bibles` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_character_versions_character_id` ON `character_versions` (`character_id`);--> statement-breakpoint
CREATE INDEX `idx_episodes_project_id` ON `episodes` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_location_bibles_project_id` ON `location_bibles` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_location_versions_location_id` ON `location_versions` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_production_scenes_episode_id` ON `production_scenes` (`episode_id`);--> statement-breakpoint
CREATE INDEX `idx_shots_scene_id` ON `shots` (`scene_id`);--> statement-breakpoint
CREATE INDEX `idx_takes_shot_id` ON `takes` (`shot_id`);--> statement-breakpoint
PRAGMA optimize;
