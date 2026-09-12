import { env } from "cloudflare:workers";

export type AIMessage = { role: "user" | "assistant"; content: string };
export type AIImage = { mimeType: string; data: string };
export type AIRequest = { system?: string; prompt: string; messages?: AIMessage[]; images?: AIImage[]; schema?: Record<string, unknown>; temperature?: number };

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  generateText(input: AIRequest): Promise<string>;
  analyzeImage(input: AIRequest & { images: [AIImage] }): Promise<string>;
  analyzeImages(input: AIRequest & { images: AIImage[] }): Promise<string>;
  generateStructuredOutput<T>(input: AIRequest): Promise<T>;
  chat(input: AIRequest): Promise<string>;
}

export class AIProviderError extends Error {
  constructor(message: string, readonly diagnostic: { provider: string; model: string; httpStatus?: number; errorCode?: string; parseError?: string }) { super(message); this.name = "AIProviderError"; }
}

export function aiErrorDiagnostic(error: unknown, provider: Pick<AIProvider,"id"|"model">) {
  if (error instanceof AIProviderError) return error.diagnostic;
  return { provider: provider.id, model: provider.model, errorCode: error instanceof SyntaxError ? "AI_RESPONSE_PARSE_ERROR" : "AI_ANALYSIS_UNAVAILABLE", parseError: error instanceof SyntaxError ? error.message : undefined };
}

function outputText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  if (typeof item.output_text === "string") return item.output_text;
  if (item.type === "output_text" && typeof item.text === "string") return item.text;
  for (const key of ["output", "content"]) {
    const nested = item[key];
    if (Array.isArray(nested)) {
      const text = nested.map(outputText).filter(Boolean).join("\n");
      if (text) return text;
    }
  }
  return "";
}

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  readonly model = env.OPENAI_MODEL || "gpt-5.6-luna";

  private async request(input: AIRequest) {
    if (!env.OPENAI_API_KEY) throw new AIProviderError("OPENAI_NOT_CONFIGURED", { provider: this.id, model: this.model, errorCode: "OPENAI_NOT_CONFIGURED" });
    const history = (input.messages || []).map((message) => ({ role: message.role, content: [{ type: "input_text", text: message.content }] }));
    const content: Record<string, string>[] = [{ type: "input_text", text: input.prompt }];
    for (const image of input.images || []) content.push({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}` });
    const body: Record<string, unknown> = { model: this.model, input: [...history, { role: "user", content }], store: false };
    if (input.system) body.instructions = input.system;
    if (input.schema) body.text = { format: { type: "json_schema", name: "response", strict: true, schema: input.schema } };
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) { throw new AIProviderError("OPENAI_RESPONSE_PARSE_ERROR", { provider: this.id, model: this.model, httpStatus: response.status, errorCode: "OPENAI_RESPONSE_PARSE_ERROR", parseError: error instanceof Error ? error.message : "Invalid JSON" }); }
    if (!response.ok) {
      const apiError = payload && typeof payload === "object" ? (payload as { error?: { code?: string; type?: string } }).error : undefined;
      throw new AIProviderError(`OPENAI_${response.status}`, { provider: this.id, model: this.model, httpStatus: response.status, errorCode: apiError?.code || apiError?.type || `HTTP_${response.status}` });
    }
    const text = outputText(payload);
    if (!text) throw new AIProviderError("OPENAI_EMPTY_RESPONSE", { provider: this.id, model: this.model, httpStatus: response.status, errorCode: "OPENAI_EMPTY_RESPONSE", parseError: "No output_text found" });
    return text;
  }

  generateText(input: AIRequest) { return this.request(input); }
  analyzeImage(input: AIRequest & { images: [AIImage] }) { return this.request(input); }
  analyzeImages(input: AIRequest & { images: AIImage[] }) { return this.request(input); }
  chat(input: AIRequest) { return this.request(input); }
  async generateStructuredOutput<T>(input: AIRequest) {
    const text = await this.request(input);
    try { return JSON.parse(text) as T; }
    catch (error) { throw new AIProviderError("OPENAI_STRUCTURED_OUTPUT_PARSE_ERROR", { provider: this.id, model: this.model, errorCode: "OPENAI_STRUCTURED_OUTPUT_PARSE_ERROR", parseError: error instanceof Error ? error.message : "Invalid JSON" }); }
  }
}

export function configuredAIProvider(): AIProvider { return new OpenAIProvider(); }

export function aiProviderStatus() {
  const provider = new OpenAIProvider();
  return { id: provider.id, name: "OpenAI", model: provider.model, configured: Boolean(env.OPENAI_API_KEY), status: env.OPENAI_API_KEY ? "CONNECTED" : "NOT_CONFIGURED" };
}
