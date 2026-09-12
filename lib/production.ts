export type QualityTarget = "PREVIEW" | "STANDARD" | "HIGH" | "HERO";
export type BudgetMode = "FREE_ONLY" | "ECONOMY" | "BALANCED" | "QUALITY_FIRST" | "CUSTOM";
export type ShotStatus = "DRAFT" | "READY" | "QUEUED" | "GENERATING" | "REVIEW" | "GENERATED" | "APPROVED" | "REJECTED" | "FAILED" | "PAUSED";
export type TakeStatus = "QUEUED" | "PREPARING" | "WAITING_PROVIDER" | "GENERATING" | "DOWNLOADING" | "VERIFYING" | "REVIEW" | "APPROVED" | "REJECTED" | "FAILED" | "PAUSED" | "AUTH_REQUIRED";
export type TransitionType = "AUTO" | "CUT" | "CUT_ON_ACTION" | "REACTION_CUT" | "MATCH_CUT" | "CONTINUOUS_TRANSITION" | "BRIDGE_SHOT";

export type ReferenceKind = "OFFICIAL_IDENTITY" | "FACE" | "HAIR" | "COSTUME" | "FULL_BODY" | "ACTION" | "ARCHIVE";
export type AssetRef = { id: string; name: string; type: string; kind?: string };
export type CharacterVersion = { id: string; label: string; active?: boolean; createdAt?: string; promptAnchor: string; immutable: string; allowed?: string; forbidden: string; references: AssetRef[] };
export type CharacterBible = { id: string; name: string; role: string; description?: string; age?: string; dominantHand?: string; persistentObjects?: string; activeVersionId?: string; knownFailures?: string[]; versions: CharacterVersion[] };
export type LocationVersion = { id: string; label: string; promptAnchor: string; immutable: string; allowed?: string; forbidden: string; references: AssetRef[] };
export type LocationBible = { id: string; name: string; description?: string; versions: LocationVersion[] };
export type PropBible = { id: string; name: string; description: string; rules: string; status: "ACTIVE" | "INACTIVE" };
export type Take = { id: string; generationId?: string; providerJobId?: string; bridgeStatus?: string; provider: string; model: string; status: TakeStatus; progress?: number; prompt: string; createdAt: string; outputAsset?: AssetRef; outputUrl?: string; externalActionUrl?: string; finalFrame?: AssetRef; rejectionReasons: string[]; notes: string; estimatedCost?: number; actualCost?: number };
export type ReferenceRecommendation = { priority: 1 | 2 | 3; label: string; purpose: string; asset: AssetRef };
export type ContinuityAnalysis = { score: number; critical: string[]; warnings: string[]; checks: string[]; transition: Exclude<TransitionType,"AUTO">; transitionReason: string; references: ReferenceRecommendation[]; sourceLabel?: string; analyzedAt: string };
export type PreviousShotResolution = { sceneId: string; expectedShotNumber: number | null; expectedCode: string | null; isFirst: boolean; shot?: ProductionShot; approvedTake?: Take; approvedFrame?: AssetRef };

export type ProductionShot = {
  id: string; title: string; sceneNumber: number; shotNumber: number; action: string; camera: string; duration: string; durationMode: "AUTO" | "MANUAL";
  continuity: string; negative: string; storyboard?: AssetRef; assets: AssetRef[]; queued: boolean; status: ShotStatus; qualityTarget: QualityTarget;
  preferredProvider: string; startFrameMode: "CANONICAL" | "PREVIOUS_LAST_FRAME" | "CUSTOM"; characterVersionIds: string[];
  locationVersionId: string; transitionType: TransitionType; autoMode: boolean; takes: Take[]; approvedTakeId?: string;
  promptDraft?: string; preparedPrompt?: string; analysis?: ContinuityAnalysis;
};

export type ProductionProject = {
  title: string; url: string; style: string; styleNegative: string; budgetMode: BudgetMode;
  storyRules: string; continuityRules: string; scenes: ProductionShot[]; characters: CharacterBible[]; locations: LocationBible[]; props: PropBible[];
};

export const SCAEVA_STYLE = "Dark cinematic painterly CGI. Mature historical animated drama. Grounded Ancient Rome. Serious and somber. Realistic anatomy, worn fabrics, dirty architecture, atmospheric depth.";
export const SCAEVA_STYLE_NEGATIVE = "Never Pixar, Disney, anime, fantasy, modern objects, glossy family animation.";

export function scaevaCharacterDefaults(): CharacterBible[] {
  return [
    { id: "character-scaeva", name: "Scaeva", role: "Protagonist", age: "12", dominantHand: "Left", persistentObjects: "Father's Coin", knownFailures: ["hair sometimes becomes red", "necklace or coin may duplicate"], activeVersionId: "scaeva-v1", description: "Thin early-adolescent Roman boy.", versions: [{ id: "scaeva-v1", label: "V1", active: true, promptAnchor: "Thin early-adolescent Roman boy, dark brown near-black messy hair, worn dark-brown Roman tunic, left-handed.", immutable: "Age 12 appearance. Exactly one leather cord and exactly one dull old father's coin.", forbidden: "Red or blond hair, duplicate necklace, duplicate father's coin, small-child proportions.", references: [] }] },
    { id: "character-vitus", name: "Vitus", role: "Supporting character", age: "15–16", dominantHand: "", persistentObjects: "", knownFailures: ["hair often becomes too short", "face sometimes changes", "sometimes appears too old"], activeVersionId: "vitus-v1", description: "Taller than Scaeva; lean adolescent.", versions: [{ id: "vitus-v1", label: "V1", active: true, promptAnchor: "Lean Roman adolescent, taller than Scaeva, copper-red ginger hair that is relatively long, full, voluminous, messy and lightly wavy-curly.", immutable: "Adolescent face and lean body proportions; long voluminous copper-red hair.", forbidden: "Short flat hair, adult face, armor, noble clothing.", references: [] }] },
  ];
}

export function activeCharacterVersion(character: CharacterBible) {
  return character.versions.find((version) => version.id === character.activeVersionId) || character.versions.find((version) => version.active) || character.versions.at(-1);
}

export function resolveDurationSeconds(shot: ProductionShot) {
  if (shot.durationMode === "AUTO" || shot.duration === "AUTO") return 5;
  const value = Number(shot.duration);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 5;
}

export function resolveCharacterVersionIds(project: ProductionProject, shot: ProductionShot) {
  const explicitCharacters = project.characters.filter((character) => character.versions.some((version) => shot.characterVersionIds.includes(version.id)));
  const inferredCharacters = explicitCharacters.length ? explicitCharacters : project.characters.filter((character) => new RegExp(`\\b${character.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i").test(`${shot.title} ${shot.action}`));
  return inferredCharacters.flatMap((character) => {
    if (!shot.autoMode) return character.versions.filter((version) => shot.characterVersionIds.includes(version.id)).map((version) => version.id);
    const active = activeCharacterVersion(character); return active ? [active.id] : [];
  });
}

export function resolveLocationVersion(project: ProductionProject, shot: ProductionShot) {
  for (const location of project.locations) { const version = location.versions.find((item) => item.id === shot.locationVersionId); if (version) return { location, version }; }
  if (project.locations.length === 1 && project.locations[0].versions[0]) return { location: project.locations[0], version: project.locations[0].versions[0] };
  const text = `${shot.title} ${shot.action} ${shot.continuity}`.toLowerCase();
  const aliases: [RegExp,RegExp][] = [[/beco|alley|passagem lateral|rota de fuga/,/alley|alleyway|beco/],[/mercado|market|banca|stall/,/market|mercado/],[/casa|house|interior|porta trancada/,/house|casa/]];
  for (const [shotPattern,locationPattern] of aliases) if (shotPattern.test(text)) { const location = project.locations.find((item) => locationPattern.test(`${item.name} ${item.description || ""}`)); if (location?.versions[0]) return { location, version: location.versions[0] }; }
  return undefined;
}

function shotReferenceKinds(shot: ProductionShot): ReferenceKind[] {
  const description = `${shot.camera} ${shot.action}`.toLowerCase();
  if (/(hair|cabelo|cabelos)/.test(description)) return ["OFFICIAL_IDENTITY", "HAIR", "FACE"];
  if (/(close|close-up|closeup|primeiro plano|rosto)/.test(description)) return ["OFFICIAL_IDENTITY", "FACE", "HAIR"];
  if (/(costas|from behind|back view)/.test(description)) return ["OFFICIAL_IDENTITY", "COSTUME", "FULL_BODY"];
  if (/(full body|corpo inteiro|wide|plano geral)/.test(description)) return ["OFFICIAL_IDENTITY", "FULL_BODY", "COSTUME"];
  if (/(corre|salta|luta|run|jump|fight|action)/.test(description)) return ["OFFICIAL_IDENTITY", "FULL_BODY", "ACTION", "COSTUME"];
  return ["OFFICIAL_IDENTITY", "FACE", "COSTUME"];
}

export const rejectionReasons = ["CHARACTER_IDENTITY","FACE","HAIR","CLOTHING","BODY_PROPORTIONS","LOCATION","PROP","CAMERA","MOTION","PHYSICS","COMPOSITION","ARTIFACT","STYLE","CONTINUITY","OTHER"] as const;

export function approvedTake(shot: ProductionShot) {
  return shot.takes.find((take) => take.id === shot.approvedTakeId && take.status === "APPROVED");
}

export function sceneIdForShot(shot: ProductionShot) {
  return `scene-${String(shot.sceneNumber).padStart(2,"0")}`;
}

export function findPreviousShot(project: ProductionProject, sceneId: string, shotId: string): PreviousShotResolution {
  const current = project.scenes.find((shot) => shot.id === shotId);
  if (!current) throw new Error("Plano não encontrado.");
  const currentSceneId = sceneIdForShot(current);
  if (sceneId !== currentSceneId) throw new Error("Cena não corresponde ao plano.");
  if (current.shotNumber <= 1) return { sceneId, expectedShotNumber: null, expectedCode: null, isFirst: true };
  const expectedShotNumber = current.shotNumber - 1;
  const expectedCode = `${String(current.sceneNumber).padStart(2,"0")}.${String(expectedShotNumber).padStart(2,"0")}`;
  const shot = project.scenes.find((candidate) => candidate.sceneNumber === current.sceneNumber && candidate.shotNumber === expectedShotNumber);
  const take = shot ? approvedTake(shot) : undefined;
  return { sceneId, expectedShotNumber, expectedCode, isFirst: false, shot, approvedTake: take, approvedFrame: take?.finalFrame };
}

export function previousShot(project: ProductionProject, shotId: string) {
  const current = project.scenes.find((shot) => shot.id === shotId);
  return current ? findPreviousShot(project, sceneIdForShot(current), shotId).shot : undefined;
}

export function previousApprovedTake(project: ProductionProject, shotId: string) {
  const current = project.scenes.find((shot) => shot.id === shotId);
  return current ? findPreviousShot(project, sceneIdForShot(current), shotId).approvedTake : undefined;
}

export function shotCode(shot: ProductionShot) {
  return `${String(shot.sceneNumber).padStart(2,"0")}.${String(shot.shotNumber).padStart(2,"0")}`;
}

export function buildContinuityContext(project: ProductionProject, shotId: string) {
  const shot = project.scenes.find((item) => item.id === shotId);
  if (!shot) throw new Error("Plano não encontrado.");
  const characters = resolveCharacterVersionIds(project, shot).flatMap((versionId) => project.characters.flatMap((character) => {
    const requested = character.versions.find((version) => version.id === versionId);
    if (!requested) return [];
    const version = shot.autoMode ? activeCharacterVersion(character) || requested : requested;
    const kinds = shotReferenceKinds(shot);
    const kindOrder: Record<string, number> = { OFFICIAL_IDENTITY: 0, FACE: 1, HAIR: 2, FULL_BODY: 3, COSTUME: 4, ACTION: 5 };
    const available = version.references.filter((asset) => asset.kind !== "ARCHIVE" && (!asset.kind || kinds.includes(asset.kind as ReferenceKind))).sort((a,b) => (kindOrder[a.kind || "OFFICIAL_IDENTITY"] ?? 9) - (kindOrder[b.kind || "OFFICIAL_IDENTITY"] ?? 9));
    const relevant = kinds.flatMap((kind) => available.find((asset) => (asset.kind || "OFFICIAL_IDENTITY") === kind) || []).slice(0,3);
    return [{ character: character.name, age: character.age, version: version.label, promptAnchor: version.promptAnchor, immutable: version.immutable, forbidden: version.forbidden, references: relevant, knownFailures: character.knownFailures || [] }];
  }));
  const resolvedLocation = resolveLocationVersion(project, shot);
  const location = resolvedLocation ? { location: resolvedLocation.location.name, version: resolvedLocation.version.label, promptAnchor: resolvedLocation.version.promptAnchor, immutable: resolvedLocation.version.immutable, forbidden: resolvedLocation.version.forbidden, references: resolvedLocation.version.references } : undefined;
  const previousResolution = findPreviousShot(project, sceneIdForShot(shot), shotId);
  const previous = previousResolution.shot;
  const previousTake = previousResolution.approvedTake;
  const selectedStartFrame = shot.startFrameMode === "PREVIOUS_LAST_FRAME" ? previousTake?.finalFrame : shot.assets.find((asset) => asset.kind === "START_FRAME");
  return {
    seriesStyle: project.style,
    styleNegative: project.styleNegative,
    shot: { id: shot.id, code: shotCode(shot), title: shot.title, action: shot.action, camera: shot.camera, duration: shot.duration, continuity: shot.continuity, negative: shot.negative, qualityTarget: shot.qualityTarget, storyboard: shot.storyboard || null },
    characters,
    location: location || null,
    previousShot: previous ? { id: previous.id, code: shotCode(previous), title: previous.title, action: previous.action, status: previous.status } : null,
    previousShotResolution: { expectedCode: previousResolution.expectedCode, isFirst: previousResolution.isFirst, imported: Boolean(previous), approved: Boolean(previousTake), approvedFrame: Boolean(previousResolution.approvedFrame) },
    previousApprovedTake: previousTake ? { id: previousTake.id, provider: previousTake.provider, finalFrame: previousTake.finalFrame || null } : null,
    selectedStartFrame: selectedStartFrame || null,
  };
}

export function recommendTransition(project: ProductionProject, shotId: string): { type: Exclude<TransitionType,"AUTO">; reason: string } {
  const shot = project.scenes.find((item) => item.id === shotId);
  if (!shot) throw new Error("Plano não encontrado.");
  if (shot.transitionType !== "AUTO") return { type: shot.transitionType, reason: "Escolha manual do realizador." } as { type: Exclude<TransitionType,"AUTO">; reason: string };
  const previousResolution = findPreviousShot(project, sceneIdForShot(shot), shotId);
  const previous = previousResolution.shot;
  if (previousResolution.isFirst) return { type: "CUT", reason: "Primeiro plano da sequência; não existe número anterior." };
  if (!previous) return { type: "CUT", reason: `O plano anterior ${previousResolution.expectedCode} ainda não foi importado.` };
  const current = shot.action.toLowerCase();
  const before = previous.action.toLowerCase();
  if (/reage|reação|looks at|react/.test(current)) return { type: "REACTION_CUT", reason: "O novo plano mostra a reação de outra personagem." };
  if (/(corre|correndo|run|running|salta|jump)/.test(current) && /(corre|correndo|run|running|salta|jump)/.test(before)) return { type: "CUT_ON_ACTION", reason: "O movimento atravessa os dois planos e deve manter direção e ritmo." };
  if (shot.characterVersionIds.some((id) => previous.characterVersionIds.includes(id)) && /(continua|segue|continues|keeps)/.test(current)) return { type: "CONTINUOUS_TRANSITION", reason: "A mesma ação e personagem continuam no plano seguinte." };
  return { type: "CUT", reason: "Um corte simples preserva clareza sem criar uma transição sem motivo narrativo." };
}

export function analyzeContinuity(project: ProductionProject, shotId: string): ContinuityAnalysis {
  const context = buildContinuityContext(project, shotId);
  const transition = recommendTransition(project, shotId);
  const critical: string[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];
  const references: ReferenceRecommendation[] = [];
  let score = 100;
  for (const character of context.characters) {
    if (!character.references.length) { critical.push(`Referência oficial de ${character.character} necessária.`); score -= 18; }
    else {
      checks.push(`${character.character} usa apenas a versão ativa (${character.version}).`);
      for (const asset of character.references) references.push({ priority: 1, label: `${character.character} · ${asset.name}`, purpose: asset.kind === "FACE" ? "rosto" : asset.kind === "HAIR" ? "cabelo" : asset.kind === "COSTUME" ? "roupa" : asset.kind === "FULL_BODY" ? "proporções e corpo inteiro" : asset.kind === "ACTION" ? "movimento" : "identidade oficial", asset });
    }
  }
  if (!context.characters.length) { warnings.push("Nenhuma personagem selecionada."); score -= 8; }
  if (!context.previousShotResolution.isFirst && !context.previousShot) { warnings.push(`Previous shot ${context.previousShotResolution.expectedCode} is not imported.`); score -= 12; }
  else if (context.previousShot && !context.previousApprovedTake) { warnings.push("Previous shot exists but is not approved."); score -= 12; }
  else if (context.previousApprovedTake && !context.previousApprovedTake.finalFrame) { warnings.push(`Previous shot ${context.previousShot?.code} is approved but has no last frame.`); score -= 12; }
  if (context.previousApprovedTake?.finalFrame) {
    references.push({ priority: 2, label: `Último frame ${context.previousShot?.code}`, purpose: "posição, luz, cenário, direção e objetos", asset: context.previousApprovedTake.finalFrame });
    checks.push("Continuidade do plano anterior disponível.");
  }
  if (context.shot.storyboard) {
    references.push({ priority: 3, label: `Storyboard ${context.shot.code}`, purpose: "câmara, enquadramento, ação e emoção", asset: context.shot.storyboard });
    checks.push("Storyboard atual disponível.");
  } else { critical.push("Storyboard do plano necessário."); score -= 22; }
  if (context.location) {
    checks.push(`${context.location.location} associada ao plano.`);
    for (const asset of context.location.references.filter((item) => item.kind !== "ARCHIVE")) references.push({ priority: 1, label: `${context.location.location} · ${asset.name}`, purpose: "local, cenário, arquitetura e ambiente", asset });
  }
  else { warnings.push("Location not explicitly assigned; storyboard will be used as environment reference."); score -= 6; }
  return { score: Math.max(0, score), critical, warnings, checks, transition: transition.type, transitionReason: transition.reason, references, sourceLabel: context.previousApprovedTake?.finalFrame ? `Shot ${context.previousShot?.code}` : undefined, analyzedAt: new Date().toISOString() };
}

export function compilePrompt(project: ProductionProject, shot: ProductionShot, provider: string, analysis = shot.analysis || analyzeContinuity(project, shot.id)) {
  const context = buildContinuityContext(project, shot.id);
  const characters = context.characters.map((item) => `${item.character}${item.age ? `, age ${item.age}` : ""} — ${item.promptAnchor}\nLOCK: ${item.immutable}\nNEVER: ${item.forbidden}${item.knownFailures.length ? `\nKNOWN FAILURES TO PREVENT: ${item.knownFailures.join("; ")}.` : ""}`).join("\n\n");
  const location = context.location ? `${context.location.location} — ${context.location.promptAnchor}\nLOCK: ${context.location.immutable}\nNEVER: ${context.location.forbidden}` : "Preserve the grounded environment established by the starting continuity reference.";
  const props = project.props.filter((item) => item.status === "ACTIVE" && (shot.action.toLowerCase().includes(item.name.toLowerCase()) || shot.continuity.toLowerCase().includes(item.name.toLowerCase()))).map((item) => `${item.name}: ${item.description} LOCK: ${item.rules}`).join("\n");
  const referencePriority = analysis.references.map((item) => `${item.priority}. ${item.label.toUpperCase()} — use for ${item.purpose}.`).join("\n") || "No image reference is available; do not invent character identity details.";
  const starting = context.previousApprovedTake?.finalFrame ? `Continue exactly from the approved final frame of Shot ${context.previousShot?.code}. Preserve position, lighting, environment, screen direction and visible props.` : "Begin from the current storyboard while respecting all identity locks.";
  const duration = resolveDurationSeconds(shot);
  const negative = [project.styleNegative, shot.negative, ...context.characters.map((item) => item.forbidden)].filter(Boolean).join(" ");
  const prompt = `SHOT NAME\n${shotCode(shot)} — ${shot.title}\n\nREFERENCE PRIORITY\n${referencePriority}\n4. TEXT PROMPT — use only for movement, timing, performance and restrictions.\n\nSTARTING CONTINUITY\n${starting}\nTransition: ${analysis.transition}. ${analysis.transitionReason}\n\nCHARACTER LOCKS\n${characters || "No visible character is selected."}\n\nACTION\n${shot.action}\nDo not repeat an action already completed and do not anticipate the next shot.\n\nCAMERA\n${shot.camera}\nMaintain coherent screen direction and camera side.\n\nENVIRONMENT\n${location}${props ? `\n\nACTIVE PROPS\n${props}` : ""}\n\nLIGHTING\nPreserve the previous approved lighting unless the storyboard clearly motivates a change.\n\nSTYLE\n${project.style}\nSTORY RULES: ${project.storyRules}\nCONTINUITY RULES: ${project.continuityRules}\n\nENDING\nEnd on a stable, usable continuity frame for the next shot.\n\nSTRICT NEGATIVE LOCK\n${negative}\n\nOUTPUT\n${duration} seconds. No captions, text, logos or watermark. Natural physics, controlled motion, cinematic continuity.`;
  if (provider === "veo") return `${prompt}\nPrioritize identity fidelity, temporal coherence and cinematic detail.`;
  if (provider === "vibes") return `${prompt}\nKeep motion clear and economical. Follow attached references in the stated priority order.`;
  return prompt;
}
