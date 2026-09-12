import { env } from "cloudflare:workers";
import type { AssistantAttachment, AssistantMessage } from "./assistant-types.ts";
import type { AssistantContext } from "./assistant-context.ts";
import { localContextAnswer } from "./assistant-context.ts";
import { configuredAIProvider } from "./ai-provider.ts";

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function attachmentInputs(attachments: AssistantAttachment[]) {
  if (!env.BUCKET) return [];
  const output: { mimeType: string; data: string }[] = []; let total = 0;
  for (const attachment of attachments.slice(0, 4)) {
    if (!attachment.type.startsWith("image/") || !/^[a-f0-9-]{36}$/.test(attachment.id)) continue;
    const object = await env.BUCKET.get(attachment.id);
    if (!object || object.size > 8 * 1024 * 1024 || total + object.size > 15 * 1024 * 1024) continue;
    total += object.size; output.push({ mimeType: attachment.type, data: toBase64(await object.arrayBuffer()) });
  }
  return output;
}

export async function callAssistantProvider(input: { context: AssistantContext; message: string; history: AssistantMessage[]; attachments: AssistantAttachment[] }) {
  if (!env.OPENAI_API_KEY) return { answer: localContextAnswer(input.context, input.message), provider: "context-engine", model: "deterministic" };
  const provider = configuredAIProvider();
  const system = `You are PROJECT ASSISTANT inside PromptDirector. Answer in the user's language. Use the structured context and never ask for facts already present. Be concise. Default format: Recommendation, Reason, Next. Never claim a suggested action was applied. Never invent missing facts.\n\nSTRUCTURED PROJECT CONTEXT\n${JSON.stringify(input.context)}`;
  try {
    const answer = await provider.chat({ system, prompt: input.message, messages: input.history.slice(-8).map(({ role, content }) => ({ role, content })), images: await attachmentInputs(input.attachments), temperature: input.context.mode === "STORY" ? 0.65 : 0.25 });
    return { answer, provider: provider.id, model: provider.model };
  } catch (error) {
    console.error("OpenAI assistant error", error);
    return { answer: localContextAnswer(input.context, input.message), provider: "context-engine", model: "deterministic" };
  }
}
