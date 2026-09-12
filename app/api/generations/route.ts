import { database } from "@/lib/storage";
import type { ProductionProject } from "@/lib/production";
import { configuredVideoProvider } from "@/lib/video-providers";
import { buildGenerationPreflight } from "@/lib/generation-package";
import { env } from "cloudflare:workers";

type GenerationRow = { id: string; project_id: string; shot_id: string; take_id: string; provider: string; provider_job_id: string | null; status: string; progress: number; generation_package: string; output_url: string | null; error: string | null; created_at: string; updated_at: string };
function responseRow(row: GenerationRow) { return { id: row.id, projectId: row.project_id, shotId: row.shot_id, takeId: row.take_id, provider: row.provider, providerJobId: row.provider_job_id, status: row.status, progress: row.progress, generationPackage: JSON.parse(row.generation_package), outputUrl: row.output_url, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at }; }
async function cacheVideo(db: ReturnType<typeof database>, row: GenerationRow, outputUrl: string) {
  const existing = await db.prepare("SELECT local_asset_id FROM remote_assets WHERE provider = ? AND remote_id = ?").bind(row.provider, row.id).first<{ local_asset_id: string }>();
  if (existing) return { id: existing.local_asset_id, name: `${row.shot_id}-generated.mp4`, type: "video/mp4", kind: "GENERATED_VIDEO" };
  const response = await fetch(outputUrl);
  const type = response.headers.get("content-type") || ""; const length = Number(response.headers.get("content-length") || 0);
  if (!response.ok || !type.startsWith("video/") || length > 150 * 1024 * 1024 || !env.BUCKET || !response.body) throw new Error("INVALID_PROVIDER_VIDEO");
  const assetId = crypto.randomUUID(); const now = new Date().toISOString();
  await env.BUCKET.put(assetId, response.body, { httpMetadata: { contentType: type } });
  await db.batch([
    db.prepare("INSERT INTO assets (id,project_id,owner_type,owner_id,kind,name,mime_type,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(assetId, row.project_id, "GENERATION", row.id, "GENERATED_VIDEO", `${row.shot_id}-generated.mp4`, type, assetId, now),
    db.prepare("INSERT INTO remote_assets (id,provider,local_asset_id,remote_id,remote_url,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), row.provider, assetId, row.id, outputUrl, now),
  ]);
  return { id: assetId, name: `${row.shot_id}-generated.mp4`, type, kind: "GENERATED_VIDEO" };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { projectId?: string; shotId?: string; provider?: string; transport?: "BROWSER_EXTENSION" };
    const projectId = body.projectId || "main";
    if (!body.shotId) return Response.json({ error: "Indica o shot." }, { status: 400 });
    const db = database();
    const row = await db.prepare("SELECT data FROM studio WHERE id = ?").bind(projectId).first<{ data: string }>();
    if (!row) return Response.json({ error: "Guarda o projeto antes de gerar." }, { status: 404 });
    const project = JSON.parse(row.data) as ProductionProject;
    const shot = project.scenes.find((item) => item.id === body.shotId);
    if (!shot?.preparedPrompt) return Response.json({ error: "Prepara o shot antes de gerar." }, { status: 409 });
    if (!shot.analysis) return Response.json({ error: "Generation package invalid", missing: ["Shot analysis is required."], invalid: [], unresolvedAssets: [] }, { status: 409 });
    const provider = configuredVideoProvider(body.provider || shot.preferredProvider);
    const generationPackage = provider.prepareGeneration(project, shot, new URL(request.url).origin);
    const preflight = buildGenerationPreflight(project, shot, generationPackage);
    const missing = [...preflight.missing];
    if (process.env.NODE_ENV === "development") console.info("GENERATION_PACKAGE_PREFLIGHT", { hasPrompt: Boolean(generationPackage.generation.prompt), hasStoryboard: generationPackage.references.some((item) => item.role === "STORYBOARD"), hasLocation: Boolean(shot.locationVersionId), hasPreviousFrame: generationPackage.references.some((item) => item.role === "PREVIOUS_FRAME"), durationSeconds: generationPackage.generation.durationSeconds, referenceCount: generationPackage.references.length, valid: preflight.valid, missing: preflight.missing, invalid: preflight.invalid });
    if (!preflight.ready || missing.length) return Response.json({ error: "Generation package invalid", missing: [...new Set(missing)], invalid: preflight.invalid, unresolvedAssets: preflight.unresolvedAssets, warnings: preflight.warnings, diagnostic: { schemaVersion: generationPackage.schemaVersion, requestId: generationPackage.requestId, fields: preflight.diagnostic } }, { status: 422 });
    const id = crypto.randomUUID(); const takeId = crypto.randomUUID(); const now = new Date().toISOString();
    const providerJob = body.transport === "BROWSER_EXTENSION" ? { status: "PREPARING" as const, progress: 0 } : await provider.startGeneration(generationPackage);
    await db.prepare("INSERT INTO generations (id,project_id,shot_id,take_id,provider,provider_job_id,status,progress,generation_package,output_url,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, projectId, shot.id, takeId, provider.id, providerJob.providerJobId || null, providerJob.status, providerJob.progress || 0, JSON.stringify(generationPackage), providerJob.outputUrl || null, providerJob.error || null, now, now).run();
    return Response.json({ id, takeId, provider: provider.id, model: "", prompt: shot.preparedPrompt, status: providerJob.status, progress: providerJob.progress || 0, providerJobId: providerJob.providerJobId, externalActionUrl: providerJob.externalActionUrl, error: providerJob.error, generationPackage, preflight, createdAt: now });
  } catch (error) {
    console.error(error); return Response.json({ error: error instanceof Error ? error.message : "Não foi possível iniciar a geração." }, { status: 503 });
  }
}

const bridgeStates: Record<string, { status: string; progress: number }> = {
  preparing: { status: "PREPARING", progress: 5 }, opening_vibes: { status: "WAITING_PROVIDER", progress: 10 }, waiting_for_vibes: { status: "WAITING_PROVIDER", progress: 15 }, auth_required: { status: "AUTH_REQUIRED", progress: 15 }, uploading_references: { status: "UPLOADING_REFERENCES", progress: 30 }, configuring: { status: "PREPARING", progress: 40 }, submitting: { status: "WAITING_PROVIDER", progress: 50 }, generating: { status: "GENERATING", progress: 60 }, processing: { status: "GENERATING", progress: 80 }, completed: { status: "REVIEW", progress: 100 }, failed: { status: "FAILED", progress: 0 }, disconnected: { status: "PAUSED", progress: 0 }, vibes_not_open: { status: "PAUSED", progress: 0 }, ready: { status: "PREPARING", progress: 0 }
};
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; takeId?: string; bridgeStatus?: string; outputUrl?: string; error?: string };
    const mapped = body.bridgeStatus ? bridgeStates[body.bridgeStatus] : undefined;
    if (!body.id || !body.takeId || !mapped) return Response.json({ error: "Estado do bridge inválido." }, { status: 400 });
    if (body.outputUrl) { const url = new URL(body.outputUrl); if (!["https:", "blob:"].includes(url.protocol)) return Response.json({ error: "Resultado inválido." }, { status: 400 }); }
    const db = database(); const row = await db.prepare("SELECT * FROM generations WHERE id = ? AND take_id = ?").bind(body.id, body.takeId).first<GenerationRow>();
    if (!row) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
    const now = new Date().toISOString();
    await db.prepare("UPDATE generations SET status = ?, progress = ?, output_url = ?, error = ?, updated_at = ? WHERE id = ?").bind(mapped.status, mapped.progress, body.outputUrl || row.output_url, body.error?.slice(0, 500) || null, now, row.id).run();
    return Response.json({ ...responseRow(row), status: mapped.status, progress: mapped.progress, bridgeStatus: body.bridgeStatus, outputUrl: body.outputUrl || row.output_url, error: body.error, updatedAt: now });
  } catch (error) { console.error(error); return Response.json({ error: "Não foi possível guardar o estado do bridge." }, { status: 503 }); }
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Indica a geração." }, { status: 400 });
    const db = database(); const row = await db.prepare("SELECT * FROM generations WHERE id = ?").bind(id).first<GenerationRow>();
    if (!row) return Response.json({ error: "Geração não encontrada." }, { status: 404 });
    if (row.provider_job_id && !["REVIEW", "APPROVED", "REJECTED", "FAILED", "PAUSED"].includes(row.status)) {
      const job = await configuredVideoProvider(row.provider).getGenerationStatus(row.provider_job_id); const now = new Date().toISOString();
      const outputUrl = job.outputUrl || row.output_url; const outputAsset = job.status === "REVIEW" && outputUrl ? await cacheVideo(db, row, outputUrl) : undefined;
      await db.prepare("UPDATE generations SET status = ?, progress = ?, output_url = ?, error = ?, updated_at = ? WHERE id = ?").bind(job.status, job.progress || row.progress, outputUrl, job.error || null, now, id).run();
      return Response.json({ ...responseRow(row), status: job.status, progress: job.progress || row.progress, outputUrl, outputAsset, error: job.error, updatedAt: now });
    }
    return Response.json(responseRow(row));
  } catch (error) { console.error(error); return Response.json({ error: "Não foi possível atualizar a geração." }, { status: 503 }); }
}
