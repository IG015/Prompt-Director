import type { AssetRef } from "./production.ts";

export type AssistantMode = "PRODUCTION" | "STORY" | "CONTINUITY" | "TECHNICAL";

export type AssistantAttachment = AssetRef & {
  label: string;
};

export type AssistantAction = {
  id: string;
  type: "OPEN_CHARACTER_REFERENCES" | "LINK_PREVIOUS_SHOT" | "SELECT_LOCATION" | "REPLACE_PROMPT";
  label: string;
  description: string;
  requiresConfirmation: true;
  payload?: Record<string, string>;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: AssistantMode;
  actions?: AssistantAction[];
  attachments?: AssistantAttachment[];
  createdAt: string;
};

export type AssistantThread = {
  id: string;
  projectId: string;
  title: string;
  sceneId?: string;
  shotId?: string;
  createdAt: string;
  updatedAt: string;
};
