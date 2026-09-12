import { analyzeContinuity, buildContinuityContext, compilePrompt, findPreviousShot, resolveDurationSeconds, sceneIdForShot, type ContinuityAnalysis, type ProductionProject } from "./production.ts";

export type PreparedShot = ReturnType<typeof deterministicLocalAnalysis> & { provider: string; model: string; usedFallback: boolean; warningCode?: "AI_ANALYSIS_UNAVAILABLE"; warning?: string; aiError?: unknown };
export type AIShotResult = { analysis: Pick<ContinuityAnalysis,"score"|"critical"|"warnings"|"checks"|"transition"|"transitionReason">; prompt: string; provider: string; model: string };

export function deterministicLocalAnalysis(project: ProductionProject, shotId: string) {
  const shot = project.scenes.find((item) => item.id === shotId);
  if (!shot) throw new Error("Plano não encontrado.");
  const context = buildContinuityContext(project, shotId);
  const previous = findPreviousShot(project, sceneIdForShot(shot), shotId);
  const analysis = analyzeContinuity(project, shotId);
  const prompt = compilePrompt(project, shot, shot.preferredProvider, analysis);
  return {
    analysis,
    prompt,
    metadata: {
      shot: { id: shot.id, code: context.shot.code, title: shot.title, sceneId: sceneIdForShot(shot) },
      characters: context.characters.map((item) => ({ name: item.character, version: item.version })),
      location: context.location ? { name: context.location.location, version: context.location.version } : null,
      activeProps: project.props.filter((item) => item.status === "ACTIVE").map((item) => ({ id: item.id, name: item.name, rules: item.rules })),
      storyboardAvailable: Boolean(shot.storyboard),
      previousShot: { expectedCode: previous.expectedCode, imported: Boolean(previous.shot), approved: Boolean(previous.approvedTake), approvedFrame: previous.approvedFrame || null },
      transitionRecommendation: analysis.transition,
      durationRecommendationSeconds: resolveDurationSeconds(shot),
      continuityWarnings: analysis.warnings,
    },
  };
}

export async function analyzeShotWithFallback(project: ProductionProject, shotId: string, analyzeWithAI?: (local: ReturnType<typeof deterministicLocalAnalysis>) => Promise<AIShotResult>): Promise<PreparedShot> {
  const local = deterministicLocalAnalysis(project, shotId);
  if (!analyzeWithAI) return { ...local, provider: "continuity-engine", model: "deterministic", usedFallback: true, warningCode: "AI_ANALYSIS_UNAVAILABLE", warning: "Análise de IA indisponível. Shot preparado usando análise local." };
  try {
    const ai = await analyzeWithAI(local);
    return { ...local, analysis: { ...local.analysis, ...ai.analysis, references: local.analysis.references, analyzedAt: new Date().toISOString() }, prompt: ai.prompt, provider: ai.provider, model: ai.model, usedFallback: false };
  } catch (aiError) {
    return { ...local, provider: "continuity-engine", model: "deterministic", usedFallback: true, warningCode: "AI_ANALYSIS_UNAVAILABLE", warning: "Análise de IA indisponível. Shot preparado usando análise local.", aiError };
  }
}
