import { env } from "cloudflare:workers";
import { aiErrorDiagnostic, configuredAIProvider } from "@/lib/ai-provider";
import { analyzeShotWithFallback } from "@/lib/shot-analysis";
import { buildContinuityContext, type ContinuityAnalysis, type ProductionProject } from "@/lib/production";

function toBase64(buffer: ArrayBuffer) { const bytes = new Uint8Array(buffer); let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }

export async function POST(request: Request) {
  try {
    const body = await request.json() as { project?: ProductionProject; shotId?: string };
    if (!body.project || !body.shotId || !Array.isArray(body.project.scenes)) return Response.json({ error: "Plano inválido." }, { status: 400 });
    const provider = configuredAIProvider();
    const result = await analyzeShotWithFallback(body.project, body.shotId, env.OPENAI_API_KEY ? async (local) => {
      const shot = body.project!.scenes.find((item) => item.id === body.shotId)!;
      const assetIds = [shot.storyboard?.id, ...local.analysis.references.map((item) => item.asset.id)].filter((id): id is string => Boolean(id)).slice(0, 4);
      const images = [];
      if (env.BUCKET) for (const id of assetIds) { const object = await env.BUCKET.get(id); if (object && object.size <= 8 * 1024 * 1024 && object.httpMetadata?.contentType?.startsWith("image/")) images.push({ mimeType: object.httpMetadata.contentType, data: toBase64(await object.arrayBuffer()) }); }
      const ai = await provider.generateStructuredOutput<{ score: number; critical: string[]; warnings: string[]; checks: string[]; transition: ContinuityAnalysis["transition"]; transitionReason: string; prompt: string }>({
        system: "You are the PromptDirector shot analyst. Preserve all canonical facts and identity locks. Return only the requested JSON. Be concise. Never invent missing project facts.",
        prompt: `Review the current deterministic analysis and improve the video prompt for the configured provider. Context: ${JSON.stringify(buildContinuityContext(body.project!, body.shotId!))}\nAnalysis: ${JSON.stringify(local.analysis)}\nCompiled prompt: ${local.prompt}`,
        images,
        schema: { type: "object", additionalProperties: false, required: ["score","critical","warnings","checks","transition","transitionReason","prompt"], properties: { score: { type: "integer", minimum: 0, maximum: 100 }, critical: { type: "array", items: { type: "string" } }, warnings: { type: "array", items: { type: "string" } }, checks: { type: "array", items: { type: "string" } }, transition: { type: "string", enum: ["CUT","CUT_ON_ACTION","REACTION_CUT","MATCH_CUT","CONTINUOUS_TRANSITION","BRIDGE_SHOT"] }, transitionReason: { type: "string" }, prompt: { type: "string" } } },
      });
      return { analysis: ai, prompt: ai.prompt, provider: provider.id, model: provider.model };
    } : undefined);
    if (result.aiError) console.error("AI analysis unavailable", aiErrorDiagnostic(result.aiError, provider));
    else if (!env.OPENAI_API_KEY) console.warn("AI analysis unavailable", { provider: provider.id, model: provider.model, errorCode: "OPENAI_NOT_CONFIGURED" });
    const { aiError: _privateError, ...response } = result;
    return Response.json(response);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Não foi possível analisar este plano." }, { status: 503 });
  }
}
