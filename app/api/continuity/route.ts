import { buildContinuityContext, type ProductionProject } from "@/lib/production";
import { database } from "@/lib/storage";

export async function GET(req: Request) {
  try {
    const shotId = new URL(req.url).searchParams.get("shotId");
    if (!shotId) return Response.json({ error: "Indica o plano." }, { status: 400 });
    const row = await database().prepare("SELECT data FROM studio WHERE id = ?").bind("main").first<{data:string}>();
    if (!row) return Response.json({ error: "Projeto não encontrado." }, { status: 404 });
    return Response.json(buildContinuityContext(JSON.parse(row.data) as ProductionProject, shotId));
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Não foi possível montar a continuidade." }, { status: 503 });
  }
}
