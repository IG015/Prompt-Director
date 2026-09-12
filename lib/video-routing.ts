import type { BudgetMode, QualityTarget } from "./production";
export type VideoCapability = "TEXT_TO_VIDEO" | "IMAGE_TO_VIDEO" | "START_FRAME" | "END_FRAME" | "REFERENCE_IMAGES" | "CHARACTER_REFERENCE" | "AUDIO";
export const videoProviders = [
  { id: "vibes", name: "Meta Vibes", costClass: "FREE", enabled: true, implementation: "CONNECTED", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "START_FRAME"] as VideoCapability[], maxDuration: 10 },
  { id: "veo", name: "Veo", costClass: "PREMIUM", enabled: false, implementation: "FOUNDATION", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "START_FRAME", "REFERENCE_IMAGES", "CHARACTER_REFERENCE"] as VideoCapability[] },
];
export function selectProvider(input: { quality: QualityTarget; budget: BudgetMode; required: VideoCapability[]; failedProviders?: string[] }) { const failed = new Set(input.failedProviders || []); return videoProviders.find((provider) => provider.enabled && !failed.has(provider.id) && input.required.every((capability) => provider.capabilities.includes(capability))) || null; }
