import { aiProviderStatus, configuredAIProvider } from "@/lib/ai-provider";
import { configuredVideoProvider, videoProviderStatuses } from "@/lib/video-providers";

export async function GET() { return Response.json({ ai: [aiProviderStatus()], video: videoProviderStatuses() }); }
export async function POST(request: Request) {
  try {
    const body = await request.json() as { provider?: string };
    if (body.provider === "openai") {
      const provider = configuredAIProvider(); await provider.generateText({ prompt: "Reply with exactly: OK" });
      return Response.json({ ok: true, provider: provider.id, model: provider.model });
    }
    if (body.provider === "vibes") {
      const status = configuredVideoProvider("vibes").status();
      return Response.json({ ok: status.configured, ...status }, { status: status.configured ? 200 : 409 });
    }
    return Response.json({ error: "Provider desconhecido." }, { status: 400 });
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : "";
    const message = detail === "OPENAI_NOT_CONFIGURED" ? "OPENAI_API_KEY não configurada." : /credit_balance_exhausted|insufficient_quota|no credits/i.test(detail) ? "A chave OpenAI é válida, mas a conta está sem créditos de API." : /OPENAI_401/.test(detail) ? "A chave OpenAI foi recusada." : "Ligação OpenAI indisponível.";
    return Response.json({ error: message }, { status: 503 });
  }
}
