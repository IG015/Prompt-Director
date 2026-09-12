import { validateGenerationPackage as validateSharedGenerationPackage } from "../browser-extension/shared/generation-package-v1.js";
import { activeCharacterVersion, findPreviousShot, recommendTransition, resolveCharacterVersionIds, resolveDurationSeconds, resolveLocationVersion, sceneIdForShot, type AssetRef, type ProductionProject, type ProductionShot } from "./production.ts";

export const VIBES_PROJECT_ID = "40c14372-cf55-4a4c-ba23-bdb454c9fb85";
export const VIBES_PROJECT_URL = `https://vibes.ai/projects/${VIBES_PROJECT_ID}`;

export type GenerationReferenceV1 = { id: string; name: string; type: string; role: string; assetUrl: string; mimeType: string };
export type GenerationPackageV1 = {
  schemaVersion: 1;
  requestId: string;
  project: { id: string; videoProvider: "vibes"; vibesProjectUrl: string };
  shot: { sceneId: string; shotId: string; title: string };
  generation: { prompt: string; durationSeconds: number; aspectRatio: string };
  references: GenerationReferenceV1[];
};
export type GenerationPreflight = { valid: boolean; ready: boolean; environmentSource: "location" | "storyboard" | null; checks: { label: string; value?: string; ok: boolean }[]; warnings: string[]; missing: string[]; invalid: string[]; unresolvedAssets: string[]; diagnostic?: unknown };

type ReferenceCandidate = { asset: AssetRef; role: string };
function referenceUrl(origin: string, asset: AssetRef) { return `${origin.replace(/\/$/,"")}/api/assets?id=${encodeURIComponent(asset.id)}`; }
function toReference(origin: string, candidate: ReferenceCandidate): GenerationReferenceV1 {
  return { id: candidate.asset.id, name: candidate.asset.name, type: candidate.asset.kind || "REFERENCE_IMAGE", role: candidate.role, assetUrl: referenceUrl(origin, candidate.asset), mimeType: candidate.asset.type };
}
export function buildGenerationPackageV1(project: ProductionProject, shot: ProductionShot, origin: string, requestId = crypto.randomUUID(), vibesProjectUrl = VIBES_PROJECT_URL): GenerationPackageV1 {
  const selectedIds = new Set(resolveCharacterVersionIds(project, shot));
  const seen = new Set<string>();
  const candidates: ReferenceCandidate[] = [];
  if (shot.storyboard) candidates.push({ asset: shot.storyboard, role: "STORYBOARD" });
  for (const character of project.characters) {
    const version = activeCharacterVersion(character);
    if (!version || !selectedIds.has(version.id)) continue;
    const official = version.references.find((asset) => asset.kind === "OFFICIAL_IDENTITY" || !asset.kind);
    if (official) candidates.push({ asset: official, role: "CHARACTER_OFFICIAL_IDENTITY" });
  }
  const vitus = project.characters.find((character) => /^vitus$/i.test(character.name) && activeCharacterVersion(character) && selectedIds.has(activeCharacterVersion(character)!.id));
  const vitusVersion = vitus ? activeCharacterVersion(vitus) : undefined;
  const hair = /(hair|cabelo)/i.test(`${shot.title} ${shot.action} ${shot.continuity}`) ? vitusVersion?.references.find((asset) => asset.kind === "HAIR") : undefined;
  if (hair) candidates.push({ asset: hair, role: "CHARACTER_HAIR" });
  const references = candidates.filter(({ asset }) => !seen.has(asset.id) && Boolean(seen.add(asset.id))).slice(0, 4);
  return {
    schemaVersion: 1,
    requestId,
    project: { id: "main", videoProvider: "vibes", vibesProjectUrl },
    shot: { sceneId: sceneIdForShot(shot), shotId: shot.id, title: shot.title },
    generation: { prompt: shot.preparedPrompt || "", durationSeconds: resolveDurationSeconds(shot), aspectRatio: "16:9" },
    references: references.map((candidate) => toReference(origin, candidate)),
  };
}

export function validateGenerationPackage(value: unknown) {
  return validateSharedGenerationPackage(value) as { success: boolean; errors: { missing: {path:string;code:string;message:string}[]; invalid: {path:string;code:string;message:string}[]; unresolvedAssets: {path:string;code:string;message:string}[] }; data?: GenerationPackageV1 };
}

export function buildGenerationPreflight(project: ProductionProject, shot: ProductionShot, generationPackage: GenerationPackageV1): GenerationPreflight {
  const validation = validateGenerationPackage(generationPackage);
  const characterIds = resolveCharacterVersionIds(project, shot);
  const selectedCharacters = project.characters.filter((character) => character.versions.some((version) => characterIds.includes(version.id)));
  const location = shot.locationVersionId ? resolveLocationVersion(project, shot)?.location : undefined;
  const previous = findPreviousShot(project, sceneIdForShot(shot), shot.id);
  const warnings = [...(shot.analysis?.warnings || [])].filter((warning) => warning !== "Localização não definida; confirme se o cenário pode variar.");
  if (!previous.isFirst && !previous.shot && previous.expectedCode && !warnings.includes(`Previous shot ${previous.expectedCode} is not imported.`)) warnings.push(`Previous shot ${previous.expectedCode} is not imported.`);
  else if (previous.shot && !previous.approvedTake && !warnings.includes("Previous shot exists but is not approved.")) warnings.push("Previous shot exists but is not approved.");
  const locationWarning = "Location not explicitly assigned; storyboard will be used as environment reference.";
  if (!location && shot.storyboard && !warnings.includes(locationWarning)) warnings.push(locationWarning);
  const checks = [
    { label: "Prompt", ok: Boolean(generationPackage.generation.prompt.trim()) },
    { label: "Duration", value: `${generationPackage.generation.durationSeconds}s`, ok: Number.isInteger(generationPackage.generation.durationSeconds) },
    { label: "Vibes project", ok: Boolean(generationPackage.project.vibesProjectUrl) },
    { label: "Storyboard", ok: generationPackage.references.some((item) => item.role === "STORYBOARD") },
    ...selectedCharacters.map((character) => { const active = activeCharacterVersion(character); return { label: `${character.name} Official`, ok: Boolean(active?.references.some((item) => item.kind === "OFFICIAL_IDENTITY" || !item.kind)) }; }),
  ];
  const missing = validation.errors.missing.map((item) => item.message);
  const invalid = validation.errors.invalid.map((item) => item.message);
  const unresolvedAssets = validation.errors.unresolvedAssets.map((item) => item.message);
  for (const check of checks.filter((item) => !item.ok)) missing.push(`${check.label} is required.`);
  const valid = validation.success && checks.every((item) => item.ok);
  return { valid, ready: valid, environmentSource: location ? "location" : shot.storyboard ? "storyboard" : null, checks, warnings: [...new Set(warnings)], missing: [...new Set(missing)], invalid, unresolvedAssets, diagnostic: validation.errors };
}

export function resolvedGenerationSettings(project: ProductionProject, shot: ProductionShot) {
  return { durationSeconds: resolveDurationSeconds(shot), transition: recommendTransition(project, shot.id).type, characterVersionIds: resolveCharacterVersionIds(project, shot) };
}
