import { env } from "cloudflare:workers";
import type { ProductionProject, ProductionShot } from "./production";
import { buildGenerationPackageV1, VIBES_PROJECT_ID, VIBES_PROJECT_URL, type GenerationPackageV1, type GenerationReferenceV1 } from "./generation-package";
export { selectProvider, videoProviders } from "./video-routing";
export type { VideoCapability } from "./video-routing";
export { VIBES_PROJECT_ID, VIBES_PROJECT_URL } from "./generation-package";
export type { GenerationPackageV1, GenerationReferenceV1 } from "./generation-package";

export type GenerationStatus = "QUEUED" | "PREPARING" | "UPLOADING_REFERENCES" | "WAITING_PROVIDER" | "GENERATING" | "DOWNLOADING" | "VERIFYING" | "REVIEW" | "APPROVED" | "REJECTED" | "FAILED" | "PAUSED" | "AUTH_REQUIRED";
export type VibesMode = "AUTO" | "DIRECT_API" | "BROWSER_BRIDGE" | "MANUAL";
export type ProviderJob = { providerJobId?: string; status: GenerationStatus; progress?: number; outputUrl?: string; error?: string; externalActionUrl?: string };
export type ProviderStatus = { id: string; name: string; configured: boolean; status: "CONNECTED" | "NOT_CONFIGURED" | "DEGRADED" | "UNAVAILABLE"; mode?: VibesMode; detail: string; projectUrl?: string };

export interface VideoGenerationProvider {
  readonly id: string;
  prepareGeneration(project: ProductionProject, shot: ProductionShot, origin: string): GenerationPackageV1;
  uploadReference(reference: GenerationReferenceV1): Promise<string>;
  startGeneration(job: GenerationPackageV1): Promise<ProviderJob>;
  getGenerationStatus(providerJobId: string): Promise<ProviderJob>;
  getResult(providerJobId: string): Promise<ProviderJob>;
  cancelGeneration(providerJobId: string): Promise<void>;
  status(): ProviderStatus;
}

export class VibesProvider implements VideoGenerationProvider {
  readonly id = "vibes";
  readonly mode: VibesMode = env.VIBES_MODE || "AUTO";
  private bridgeUrl = env.VIBES_BRIDGE_URL?.replace(/\/$/, "");
  status(): ProviderStatus {
    if (this.mode === "DIRECT_API") return { id: this.id, name: "Meta Vibes", configured: false, status: "UNAVAILABLE", mode: this.mode, detail: "No public Vibes generation API is configured. Use an authorized browser bridge or manual mode.", projectUrl: VIBES_PROJECT_URL };
    if ((this.mode === "AUTO" || this.mode === "BROWSER_BRIDGE") && this.bridgeUrl) return { id: this.id, name: "Meta Vibes", configured: true, status: "CONNECTED", mode: "BROWSER_BRIDGE", detail: "Authorized browser bridge configured.", projectUrl: VIBES_PROJECT_URL };
    if (this.mode === "MANUAL") return { id: this.id, name: "Meta Vibes", configured: true, status: "DEGRADED", mode: this.mode, detail: "Manual handoff; PromptDirector still tracks the take and continuity.", projectUrl: VIBES_PROJECT_URL };
    return { id: this.id, name: "Meta Vibes", configured: false, status: "NOT_CONFIGURED", mode: this.mode, detail: "Configure VIBES_BRIDGE_URL or select MANUAL mode.", projectUrl: VIBES_PROJECT_URL };
  }
  prepareGeneration(project: ProductionProject, shot: ProductionShot, origin: string) { return buildGenerationPackageV1(project, shot, origin); }
  async uploadReference(reference: GenerationReferenceV1) {
    if (!env.BUCKET) throw new Error("ASSET_STORAGE_NOT_CONFIGURED");
    const object = await env.BUCKET.get(reference.id);
    if (!object) throw new Error(`REFERENCE_NOT_FOUND:${reference.name}`);
    if (object.size > 10 * 1024 * 1024) throw new Error(`REFERENCE_TOO_LARGE:${reference.name}`);
    const bytes = new Uint8Array(await object.arrayBuffer()); let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return `data:${object.httpMetadata?.contentType || reference.type};base64,${btoa(binary)}`;
  }
  async startGeneration(job: GenerationPackageV1): Promise<ProviderJob> {
    const status = this.status();
    if (status.mode === "MANUAL") return { status: "AUTH_REQUIRED", externalActionUrl: VIBES_PROJECT_URL };
    if (!status.configured || !this.bridgeUrl) return { status: "AUTH_REQUIRED", error: status.detail, externalActionUrl: VIBES_PROJECT_URL };
    const uploads = await Promise.all(job.references.map(async (reference) => ({ ...reference, assetUrl: await this.uploadReference(reference) })));
    const response = await fetch(`${this.bridgeUrl}/generations`, { method: "POST", headers: { "Content-Type": "application/json", ...(env.VIBES_BRIDGE_TOKEN ? { Authorization: `Bearer ${env.VIBES_BRIDGE_TOKEN}` } : {}) }, body: JSON.stringify({ ...job, projectUrl: VIBES_PROJECT_URL, uploads }) });
    if (!response.ok) throw new Error(`VIBES_BRIDGE_${response.status}:${(await response.text()).slice(0, 240)}`);
    return await response.json() as ProviderJob;
  }
  private async bridgeJob(providerJobId: string, suffix = "") {
    if (!this.bridgeUrl) throw new Error("VIBES_BRIDGE_NOT_CONFIGURED");
    const response = await fetch(`${this.bridgeUrl}/generations/${encodeURIComponent(providerJobId)}${suffix}`, { headers: env.VIBES_BRIDGE_TOKEN ? { Authorization: `Bearer ${env.VIBES_BRIDGE_TOKEN}` } : {} });
    if (!response.ok) throw new Error(`VIBES_BRIDGE_${response.status}`);
    return await response.json() as ProviderJob;
  }
  getGenerationStatus(providerJobId: string) { return this.bridgeJob(providerJobId); }
  getResult(providerJobId: string) { return this.bridgeJob(providerJobId, "/result"); }
  async cancelGeneration(providerJobId: string) { if (!this.bridgeUrl) return; await fetch(`${this.bridgeUrl}/generations/${encodeURIComponent(providerJobId)}`, { method: "DELETE", headers: env.VIBES_BRIDGE_TOKEN ? { Authorization: `Bearer ${env.VIBES_BRIDGE_TOKEN}` } : {} }); }
}

export function configuredVideoProvider(id = "vibes"): VideoGenerationProvider { if (id === "vibes") return new VibesProvider(); throw new Error("VIDEO_PROVIDER_NOT_CONFIGURED"); }
export function videoProviderStatuses() { return [new VibesProvider().status(), { id: "veo", name: "Veo", configured: false, status: "NOT_CONFIGURED" as const, detail: "Optional future provider." }]; }
