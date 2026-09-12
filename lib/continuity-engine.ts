import { analyzeContinuity, compilePrompt, type ProductionProject } from "./production";

export function prepareShot(project: ProductionProject, shotId: string) {
  const shot = project.scenes.find((item) => item.id === shotId);
  if (!shot) throw new Error("Plano não encontrado.");
  const analysis = analyzeContinuity(project, shotId);
  const prompt = compilePrompt(project, shot, shot.preferredProvider, analysis);
  return { analysis, prompt };
}
