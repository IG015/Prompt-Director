import {
  activeCharacterVersion,
  analyzeContinuity,
  compilePrompt,
  previousShot,
  recommendTransition,
  shotCode,
  type ProductionProject,
  type ProductionShot,
} from "./production.ts";
import type { AssistantAction, AssistantMode } from "./assistant-types.ts";

export type AssistantContext = {
  scope: { projectId: string; project: string; episode: string; scene?: string; shot?: string; character?: string; entireProject: boolean };
  mode: AssistantMode;
  project: { visualStyle: string; storyRules: string; continuityRules: string; activeProps: unknown[]; shotSummary: unknown[] };
  currentShot?: Record<string, unknown>;
  previousApprovedShot?: Record<string, unknown> | null;
  nextStoryboardShot?: Record<string, unknown> | null;
  characters: unknown[];
  location?: unknown;
  continuity?: unknown;
  generationHistory: unknown[];
  rejectedTakes: unknown[];
  knownGenerationProblems: string[];
  actions: AssistantAction[];
};

export function detectAssistantMode(message: string): AssistantMode {
  const value = message.toLowerCase();
  if (/(erro|api|botão|funciona|config|provider|gemini|promptdirector|upload|atalho)/.test(value)) return "TECHNICAL";
  if (/(continuidade|continuous|referência|reference|ainda tem|versão|82%|inconsist|frame anterior)/.test(value)) return "CONTINUITY";
  if (/(história|story|narrativ|ritmo|pacing|personagem|parada|acontecer depois|next)/.test(value)) return "STORY";
  return "PRODUCTION";
}

function scopedShot(project: ProductionProject, shotId?: string) {
  return shotId ? project.scenes.find((item) => item.id === shotId) : undefined;
}

function selectedCharacters(project: ProductionProject, shot?: ProductionShot, characterId?: string) {
  return project.characters.flatMap((character) => {
    if (!shot && character.id !== characterId) return [];
    const selected = shot ? character.versions.find((version) => shot.characterVersionIds.includes(version.id)) : activeCharacterVersion(character);
    const version = shot?.autoMode ? activeCharacterVersion(character) || selected : selected;
    if (!version) return [];
    return [{
      id: character.id,
      name: character.name,
      role: character.role,
      version: version.label,
      identity: version.promptAnchor,
      locked: version.immutable,
      forbidden: version.forbidden,
      references: version.references.filter((asset) => asset.kind !== "ARCHIVE"),
      knownProblems: character.knownFailures || [],
    }];
  });
}

function activeProps(project: ProductionProject, shot?: ProductionShot) {
  const searchable = `${shot?.action || ""} ${shot?.continuity || ""}`.toLowerCase();
  return project.props.filter((prop) => prop.status === "ACTIVE" && (!shot || searchable.includes(prop.name.toLowerCase()) || searchable.includes(prop.description.toLowerCase())));
}

export function buildAssistantContext(input: {
  projectId: string;
  project: ProductionProject;
  sceneId?: string;
  shotId?: string;
  characterId?: string;
  userMessage: string;
}): AssistantContext {
  const { project, projectId, userMessage } = input;
  const shot = scopedShot(project, input.shotId);
  const index = shot ? project.scenes.findIndex((item) => item.id === shot.id) : -1;
  const before = shot ? previousShot(project, shot.id) : undefined;
  const beforeTake = before?.takes.find((take) => take.id === before.approvedTakeId && take.status === "APPROVED");
  const next = index >= 0 ? project.scenes[index + 1] : undefined;
  const characters = selectedCharacters(project, shot, input.characterId);
  const location = shot
    ? project.locations.flatMap((item) => item.versions.filter((version) => version.id === shot.locationVersionId).map((version) => ({ name: item.name, version: version.label, identity: version.promptAnchor, locked: version.immutable, forbidden: version.forbidden, references: version.references })))[0]
    : undefined;
  const continuity = shot ? shot.analysis || analyzeContinuity(project, shot.id) : undefined;
  const rejectedTakes = (shot?.takes || []).filter((take) => take.status === "REJECTED" || take.status === "FAILED").slice(-5);
  const knownGenerationProblems = characters.flatMap((character) => character.knownProblems as string[]);
  const actions: AssistantAction[] = [];

  for (const character of characters) {
    const refs = character.references as { kind?: string }[];
    if (!refs.some((asset) => asset.kind === "OFFICIAL_IDENTITY") || (/cabelo|hair|consist/i.test(userMessage) && !refs.some((asset) => asset.kind === "HAIR"))) {
      actions.push({ id: `refs-${character.id}`, type: "OPEN_CHARACTER_REFERENCES", label: `Open ${character.name} References`, description: "Review or add the missing official references.", requiresConfirmation: true, payload: { characterId: String(character.id) } });
    }
  }
  if (shot && before && !beforeTake?.finalFrame) actions.push({ id: `previous-${shot.id}`, type: "LINK_PREVIOUS_SHOT", label: "Link Previous Shot", description: `Use the approved last frame from ${shotCode(before)} when it becomes available.`, requiresConfirmation: true, payload: { shotId: shot.id } });
  if (shot && !location) actions.push({ id: `location-${shot.id}`, type: "SELECT_LOCATION", label: "Select Location", description: "Open the location library before assigning a canonical version.", requiresConfirmation: true, payload: { shotId: shot.id } });
  if (shot && /(melhor|improve|reescre|rewrite).{0,12}prompt|prompt.{0,12}(melhor|improve)/i.test(userMessage)) {
    actions.push({ id: `prompt-${shot.id}`, type: "REPLACE_PROMPT", label: "Replace Current Prompt", description: "Preview the compiled context-aware prompt before replacing the current draft.", requiresConfirmation: true, payload: { shotId: shot.id, prompt: compilePrompt(project, shot, shot.preferredProvider) } });
  }

  return {
    scope: { projectId, project: project.title, episode: "Episode 01", scene: shot ? `Scene ${String(shot.sceneNumber).padStart(2, "0")}` : undefined, shot: shot ? `Shot ${shotCode(shot)}` : undefined, character: !shot ? project.characters.find((item) => item.id === input.characterId)?.name : undefined, entireProject: !shot && !input.characterId },
    mode: detectAssistantMode(userMessage),
    project: { visualStyle: project.style, storyRules: project.storyRules, continuityRules: project.continuityRules, activeProps: activeProps(project, shot), shotSummary: shot ? [] : project.scenes.slice(0, 24).map((item) => ({ code: shotCode(item), title: item.title, action: item.action, duration: item.duration, status: item.status })) },
    currentShot: shot ? { id: shot.id, code: shotCode(shot), title: shot.title, action: shot.action, camera: shot.camera, duration: shot.duration, storyboard: shot.storyboard || null, lastApprovedFrame: shot.takes.find((take) => take.id === shot.approvedTakeId)?.finalFrame || null, continuity: shot.continuity, transition: recommendTransition(project, shot.id), provider: shot.preferredProvider, prompt: shot.preparedPrompt || shot.promptDraft || null, status: shot.status } : undefined,
    previousApprovedShot: before ? { id: before.id, code: shotCode(before), title: before.title, action: before.action, approved: Boolean(beforeTake), lastFrame: beforeTake?.finalFrame || null } : null,
    nextStoryboardShot: next ? { id: next.id, code: shotCode(next), title: next.title, action: next.action, storyboard: next.storyboard || null } : null,
    characters,
    location: location || null,
    continuity: continuity || null,
    generationHistory: (shot?.takes || []).slice(-8).map((take) => ({ provider: take.provider, model: take.model, status: take.status, notes: take.notes, createdAt: take.createdAt })),
    rejectedTakes: rejectedTakes.map((take) => ({ provider: take.provider, reasons: take.rejectionReasons, notes: take.notes })),
    knownGenerationProblems,
    actions,
  };
}

export function localContextAnswer(context: AssistantContext, message: string): string {
  const shot = context.currentShot as { code?: string; title?: string; transition?: { type: string; reason: string }; prompt?: string } | undefined;
  const continuity = context.continuity as { score?: number; critical?: string[]; warnings?: string[]; references?: { label: string; purpose: string }[] } | undefined;
  const lower = message.toLowerCase();
  const character = context.characters[0] as { name?: string; version?: string; locked?: string; references?: { kind?: string }[]; knownProblems?: string[] } | undefined;
  if (context.mode === "TECHNICAL") return `Recommendation:\nUse the current Project Assistant scope, then ask the exact operation you want to complete.\n\nReason:\nPromptDirector automatically checks Project Bible, shots, continuity, references and generation history. Suggested changes always require confirmation.\n\nNext:\nChoose a shot for production help or Entire Project for configuration guidance.`;
  if (!shot && character) {
    const references = character.references || [];
    const missing = ["OFFICIAL_IDENTITY", "FACE", "HAIR", "FULL_BODY"].filter((kind) => !references.some((asset) => asset.kind === kind));
    return `Recommendation:\n${missing.length ? `Add ${missing.slice(0, 3).join(", ")} references for ${character.name}.` : `${character.name} has the core identity references configured.`}\n\nReason:\nActive version ${character.version || "—"} has ${references.length} reference(s). ${character.locked || "Identity locks still need detail."}${character.knownProblems?.length ? ` Known problems: ${character.knownProblems.join("; ")}.` : ""}\n\nNext:\nReview the suggested reference action before changing the Project Bible.`;
  }
  if (!shot) return `Recommendation:\nUse the entire project scope for story and configuration questions.\n\nReason:\nNo specific shot is selected, so I checked Project Bible and project rules only.\n\nNext:\nSelect a shot for frame, transition, prompt, or continuity guidance.`;
  if (/transi|transition/.test(lower)) return `Recommendation:\nUse ${shot.transition?.type.replaceAll("_", " ") || "CUT"}.\n\nReason:\n${shot.transition?.reason || "It preserves the clearest continuity between the shots."}\n\nNext:\nConfirm the previous approved frame and current storyboard before generation.`;
  if (/82%|percent|pontua|score|continuidade|continuity/.test(lower)) {
    const problems = [...(continuity?.critical || []), ...(continuity?.warnings || [])];
    return `Recommendation:\nResolve ${problems[0] || "the remaining continuity warning"}.\n\nReason:\nShot ${shot.code} is at ${continuity?.score ?? 100}%. ${problems.slice(0, 3).join(" ") || "The current continuity checks are complete."}\n\nNext:\n${problems[1] || "Keep the approved previous frame linked."}`;
  }
  if (/refer|imagem|image/.test(lower)) {
    const refs = continuity?.references || [];
    return `Recommendation:\n${refs.length ? refs.slice(0, 3).map((item, index) => `${index + 1}. ${item.label} — ${item.purpose}`).join("\n") : "Add an official identity reference and the current storyboard."}\n\nReason:\nThese are the highest-priority references for shot ${shot.code}.\n\nNext:\nAttach only the listed references to reduce identity drift.`;
  }
  if (/prompt/.test(lower)) return `Recommendation:\nUse the context-aware prompt prepared for ${shot.code}.\n\nReason:\nIt combines the active character locks, location, continuity, storyboard, previous frame and configured provider.\n\nNext:\nPreview “Replace Current Prompt” before applying it.`;
  if (/depois|next|seguir|acontecer/.test(lower)) {
    const next = context.nextStoryboardShot as { code?: string; title?: string; action?: string } | null;
    return `Recommendation:\n${next ? `Prepare ${next.code} — ${next.title}.` : "End on a stable continuity frame."}\n\nReason:\n${next?.action || "There is no next storyboard shot in the current project."}\n\nNext:\nKeep screen direction, active props and character positions consistent.`;
  }
  return `Recommendation:\nKeep shot ${shot.code} focused on one readable action.\n\nReason:\nI checked the active shot, Project Bible, continuity report, references and generation history.\n\nNext:\nUse a quick question below for a targeted production check.`;
}
