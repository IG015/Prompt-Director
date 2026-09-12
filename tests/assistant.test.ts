import test from "node:test";
import assert from "node:assert/strict";
import { buildAssistantContext, detectAssistantMode, localContextAnswer } from "../lib/assistant-context.ts";
import { scaevaCharacterDefaults, type ProductionProject, type ProductionShot } from "../lib/production.ts";

function shot(id: string, number: number): ProductionShot {
  return { id, title: number === 6 ? "The Chase" : "The Hand", sceneNumber: 4, shotNumber: number, action: number === 6 ? "Scaeva continues running" : "Vitus appears to help Scaeva", camera: "Tracking medium shot", duration: "4", durationMode: "AUTO", continuity: "Continue the same chase direction", negative: "", assets: [], queued: false, status: "DRAFT", qualityTarget: "STANDARD", preferredProvider: "vibes", startFrameMode: "PREVIOUS_LAST_FRAME", characterVersionIds: ["scaeva-v1", "vitus-v1"], locationVersionId: "", transitionType: "AUTO", autoMode: true, takes: [] };
}

const project: ProductionProject = { title: "SCAEVA", url: "", style: "Dark cinematic", styleNegative: "No modern objects", budgetMode: "BALANCED", storyRules: "Grounded drama", continuityRules: "Preserve direction", characters: scaevaCharacterDefaults(), locations: [], props: [{ id: "coin", name: "Coin", description: "Scaeva's coin", rules: "Exactly one", status: "ACTIVE" }], scenes: [shot("04-06", 6), shot("04-07", 7)] };

test("assistant context is scoped to the selected shot without copying unrelated project records", () => {
  const context = buildAssistantContext({ projectId: "main", project, shotId: "04-07", userMessage: "Esse shot precisa de transição?" });
  assert.equal(context.scope.shot, "Shot 04.07");
  assert.equal(context.mode, "PRODUCTION");
  assert.equal((context.currentShot as { code: string }).code, "04.07");
  assert.equal((context.previousApprovedShot as { code: string }).code, "04.06");
  assert.ok(context.actions.some((action) => action.type === "LINK_PREVIOUS_SHOT"));
});

test("assistant mode and safe prompt action are inferred from the question", () => {
  assert.equal(detectAssistantMode("Por que a continuidade está 82%?"), "CONTINUITY");
  const context = buildAssistantContext({ projectId: "main", project, shotId: "04-07", userMessage: "Melhora esse prompt" });
  const action = context.actions.find((item) => item.type === "REPLACE_PROMPT");
  assert.ok(action?.requiresConfirmation);
  assert.match(action?.payload?.prompt || "", /SHOT NAME/);
  assert.match(localContextAnswer(context, "Melhora esse prompt"), /Replace Current Prompt/);
});
