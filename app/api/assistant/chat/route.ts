import { buildAssistantContext } from "@/lib/assistant-context";
import { callAssistantProvider } from "@/lib/assistant-provider";
import type { AssistantAction, AssistantAttachment, AssistantMessage, AssistantMode, AssistantThread } from "@/lib/assistant-types";
import type { ProductionProject } from "@/lib/production";
import { database } from "@/lib/storage";

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: AssistantMode | null;
  actions: string;
  attachments: string;
  created_at: string;
};

type ThreadRow = {
  id: string;
  project_id: string;
  title: string;
  scene_id: string | null;
  shot_id: string | null;
  created_at: string;
  updated_at: string;
};

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") || "site-owner";
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function messageFromRow(row: MessageRow): AssistantMessage {
  return { id: row.id, role: row.role, content: row.content, mode: row.mode || undefined, actions: parseJson<AssistantAction[]>(row.actions, []), attachments: parseJson<AssistantAttachment[]>(row.attachments, []), createdAt: row.created_at };
}

function threadFromRow(row: ThreadRow): AssistantThread {
  return { id: row.id, projectId: row.project_id, title: row.title, sceneId: row.scene_id || undefined, shotId: row.shot_id || undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function loadProject(projectId: string) {
  const row = await database().prepare("SELECT data FROM studio WHERE id = ?").bind(projectId).first<{ data: string }>();
  if (!row) throw new Error("PROJECT_NOT_FOUND");
  return JSON.parse(row.data) as ProductionProject;
}

function knownAssetIds(project: ProductionProject) {
  const ids = new Set<string>();
  for (const shot of project.scenes) {
    if (shot.storyboard) ids.add(shot.storyboard.id);
    for (const asset of shot.assets) ids.add(asset.id);
    for (const take of shot.takes) { if (take.outputAsset) ids.add(take.outputAsset.id); if (take.finalFrame) ids.add(take.finalFrame.id); }
  }
  for (const character of project.characters) for (const version of character.versions) for (const asset of version.references) ids.add(asset.id);
  for (const location of project.locations) for (const version of location.versions) for (const asset of version.references) ids.add(asset.id);
  return ids;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "main";
    const threadId = url.searchParams.get("threadId");
    const db = database();
    const owner = ownerId(request);
    const threads = await db.prepare("SELECT id,project_id,title,scene_id,shot_id,created_at,updated_at FROM assistant_threads WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 30").bind(projectId, owner).all<ThreadRow>();
    let messages: AssistantMessage[] = [];
    if (threadId) {
      const allowed = await db.prepare("SELECT id FROM assistant_threads WHERE id = ? AND project_id = ? AND owner_id = ?").bind(threadId, projectId, owner).first<{ id: string }>();
      if (allowed) {
        const rows = await db.prepare("SELECT id,role,content,mode,actions,attachments,created_at FROM assistant_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 100").bind(threadId).all<MessageRow>();
        messages = rows.results.map(messageFromRow);
      }
    }
    return Response.json({ threads: threads.results.map(threadFromRow), messages });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Não foi possível carregar o histórico do Project Assistant." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { projectId?: string; sceneId?: string; shotId?: string; characterId?: string; message?: string; attachments?: AssistantAttachment[]; threadId?: string };
    const projectId = body.projectId || "main";
    const message = body.message?.trim();
    if (!message || message.length > 4000) return Response.json({ error: "Escreve uma mensagem até 4000 caracteres." }, { status: 400 });
    const project = await loadProject(projectId);
    if (body.shotId && !project.scenes.some((shot) => shot.id === body.shotId)) return Response.json({ error: "O shot selecionado não pertence a este projeto." }, { status: 400 });
    if (body.characterId && !project.characters.some((character) => character.id === body.characterId)) return Response.json({ error: "A personagem selecionada não pertence a este projeto." }, { status: 400 });
    const allowedAssets = knownAssetIds(project);
    const attachments = (body.attachments || []).filter((asset) => allowedAssets.has(asset.id)).slice(0, 6);
    const db = database();
    const owner = ownerId(request);
    const now = new Date().toISOString();
    let threadId = body.threadId;
    if (threadId) {
      const existing = await db.prepare("SELECT id FROM assistant_threads WHERE id = ? AND project_id = ? AND owner_id = ?").bind(threadId, projectId, owner).first<{ id: string }>();
      if (!existing) threadId = undefined;
    }
    if (!threadId) {
      threadId = crypto.randomUUID();
      const title = message.length > 54 ? `${message.slice(0, 51)}…` : message;
      await db.prepare("INSERT INTO assistant_threads (id,project_id,owner_id,title,scene_id,shot_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(threadId, projectId, owner, title, body.sceneId || null, body.shotId || null, now, now).run();
    }
    const historyRows = await db.prepare("SELECT id,role,content,mode,actions,attachments,created_at FROM assistant_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 8").bind(threadId).all<MessageRow>();
    const history = historyRows.results.reverse().map(messageFromRow);
    const context = buildAssistantContext({ projectId, project, sceneId: body.sceneId, shotId: body.shotId, characterId: body.characterId, userMessage: message });
    const result = await callAssistantProvider({ context, message, history, attachments });
    const userMessage: AssistantMessage = { id: crypto.randomUUID(), role: "user", content: message, attachments, createdAt: now };
    const assistantMessage: AssistantMessage = { id: crypto.randomUUID(), role: "assistant", content: result.answer, mode: context.mode, actions: context.actions, createdAt: new Date().toISOString() };
    await db.batch([
      db.prepare("INSERT INTO assistant_messages (id,thread_id,role,content,mode,actions,attachments,provider,model,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(userMessage.id, threadId, "user", userMessage.content, null, "[]", JSON.stringify(attachments), null, null, userMessage.createdAt),
      db.prepare("INSERT INTO assistant_messages (id,thread_id,role,content,mode,actions,attachments,provider,model,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(assistantMessage.id, threadId, "assistant", assistantMessage.content, context.mode, JSON.stringify(context.actions), "[]", result.provider, result.model, assistantMessage.createdAt),
      db.prepare("UPDATE assistant_threads SET scene_id = ?, shot_id = ?, updated_at = ? WHERE id = ?").bind(body.sceneId || null, body.shotId || null, assistantMessage.createdAt, threadId),
    ]);
    return Response.json({ threadId, message: assistantMessage, userMessage, context: context.scope, mode: context.mode, provider: result.provider });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.message === "PROJECT_NOT_FOUND" ? "O projeto atual ainda não foi guardado." : "Não foi possível responder agora. A tua mensagem não foi perdida.";
    return Response.json({ error: message }, { status: error instanceof Error && error.message === "PROJECT_NOT_FOUND" ? 404 : 503 });
  }
}
