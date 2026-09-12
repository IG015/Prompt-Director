import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const studio = sqliteTable("studio", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
});

export const seriesProjects = sqliteTable("series_projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  budgetMode: text("budget_mode").notNull().default("BALANCED"),
  updatedAt: text("updated_at").notNull(),
});

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  seasonNumber: integer("season_number").notNull().default(1),
  episodeNumber: integer("episode_number").notNull().default(1),
  title: text("title").notNull(),
  context: text("context").notNull().default(""),
}, (table) => [index("idx_episodes_project_id").on(table.projectId)]);

export const productionScenes = sqliteTable("production_scenes", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull(),
  sceneNumber: integer("scene_number").notNull(),
  title: text("title").notNull(),
  context: text("context").notNull().default(""),
}, (table) => [index("idx_production_scenes_episode_id").on(table.episodeId)]);

export const shots = sqliteTable("shots", {
  id: text("id").primaryKey(),
  sceneId: text("scene_id").notNull(),
  shotNumber: integer("shot_number").notNull(),
  specification: text("specification").notNull(),
  status: text("status").notNull().default("DRAFT"),
  qualityTarget: text("quality_target").notNull().default("STANDARD"),
  preferredProvider: text("preferred_provider"),
  approvedTakeId: text("approved_take_id"),
}, (table) => [index("idx_shots_scene_id").on(table.sceneId)]);

export const takes = sqliteTable("takes", {
  id: text("id").primaryKey(),
  shotId: text("shot_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull().default(""),
  status: text("status").notNull(),
  prompt: text("prompt").notNull(),
  parameters: text("parameters").notNull().default("{}"),
  referenceAssets: text("reference_assets").notNull().default("[]"),
  outputAssetId: text("output_asset_id"),
  finalFrameAssetId: text("final_frame_asset_id"),
  rejectionReasons: text("rejection_reasons").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  estimatedCost: text("estimated_cost"),
  actualCost: text("actual_cost"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("idx_takes_shot_id").on(table.shotId)]);

export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  shotId: text("shot_id").notNull(),
  takeId: text("take_id").notNull(),
  provider: text("provider").notNull(),
  providerJobId: text("provider_job_id"),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  generationPackage: text("generation_package").notNull(),
  outputUrl: text("output_url"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_generations_shot_created").on(table.shotId, table.createdAt)]);

export const remoteAssets = sqliteTable("remote_assets", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  localAssetId: text("local_asset_id").notNull(),
  remoteId: text("remote_id"),
  remoteUrl: text("remote_url"),
  checksum: text("checksum"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
}, (table) => [index("idx_remote_assets_provider_local").on(table.provider, table.localAssetId)]);

export const characterBibles = sqliteTable("character_bibles", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  canonicalName: text("canonical_name").notNull(),
  role: text("role").notNull().default(""),
  description: text("description").notNull().default(""),
}, (table) => [index("idx_character_bibles_project_id").on(table.projectId)]);

export const characterVersions = sqliteTable("character_versions", {
  id: text("id").primaryKey(),
  characterId: text("character_id").notNull(),
  label: text("label").notNull(),
  promptAnchor: text("prompt_anchor").notNull().default(""),
  immutableTraits: text("immutable_traits").notNull().default(""),
  allowedVariations: text("allowed_variations").notNull().default(""),
  forbiddenVariations: text("forbidden_variations").notNull().default(""),
}, (table) => [index("idx_character_versions_character_id").on(table.characterId)]);

export const locationBibles = sqliteTable("location_bibles", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
}, (table) => [index("idx_location_bibles_project_id").on(table.projectId)]);

export const locationVersions = sqliteTable("location_versions", {
  id: text("id").primaryKey(),
  locationId: text("location_id").notNull(),
  label: text("label").notNull(),
  promptAnchor: text("prompt_anchor").notNull().default(""),
  immutableFeatures: text("immutable_features").notNull().default(""),
  allowedVariations: text("allowed_variations").notNull().default(""),
  forbiddenVariations: text("forbidden_variations").notNull().default(""),
}, (table) => [index("idx_location_versions_location_id").on(table.locationId)]);

export const styleBibles = sqliteTable("style_bibles", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  visualStyle: text("visual_style").notNull(),
  negativeConstraints: text("negative_constraints").notNull().default(""),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerType: text("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_assets_owner").on(table.ownerType, table.ownerId)]);

export const assistantThreads = sqliteTable("assistant_threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  sceneId: text("scene_id"),
  shotId: text("shot_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_assistant_threads_project_owner_updated").on(table.projectId, table.ownerId, table.updatedAt)]);

export const assistantMessages = sqliteTable("assistant_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  mode: text("mode"),
  actions: text("actions").notNull().default("[]"),
  attachments: text("attachments").notNull().default("[]"),
  provider: text("provider"),
  model: text("model"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_assistant_messages_thread_created").on(table.threadId, table.createdAt)]);
