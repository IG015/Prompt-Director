import test from "node:test";
import assert from "node:assert/strict";
import { analyzeContinuity, buildContinuityContext, compilePrompt, type ProductionProject } from "../lib/production.ts";
import { selectProvider } from "../lib/video-routing.ts";

const project: ProductionProject = {
  title: "Test", url: "", style: "cinematic", styleNegative: "no anime", storyRules: "Preserve chronology", continuityRules: "Approved frames are canonical", budgetMode: "BALANCED", props: [],
  characters: [{ id: "c", name: "Vitus", role: "hero", versions: [{ id: "cv", label: "Roman", promptAnchor: "same face and long hair", immutable: "brown eyes", forbidden: "short hair", references: [{ id: "face", name: "face.png", type: "image/png" }] }] }],
  locations: [{ id: "l", name: "Roman Alley", versions: [{ id: "lv", label: "Day", promptAnchor: "stone alley", immutable: "red door", forbidden: "modern objects", references: [] }] }],
  scenes: [
    { id: "s1", title: "One", sceneNumber: 4, shotNumber: 6, action: "running", camera: "wide", duration: "4", durationMode: "MANUAL", continuity: "same", negative: "text", assets: [], queued: false, status: "APPROVED", qualityTarget: "STANDARD", preferredProvider: "vibes", startFrameMode: "CANONICAL", characterVersionIds: ["cv"], locationVersionId: "lv", transitionType: "AUTO", autoMode: true, approvedTakeId: "t1", takes: [{ id: "t1", provider: "vibes", model: "", status: "APPROVED", prompt: "p", createdAt: "2026-01-01T00:00:00Z", rejectionReasons: [], notes: "", finalFrame: { id: "last", name: "last.png", type: "image/png" } }] },
    { id: "s2", title: "Two", sceneNumber: 4, shotNumber: 7, action: "Vitus keeps running", camera: "track", duration: "6", durationMode: "MANUAL", continuity: "continue", negative: "morph", storyboard: { id: "board", name: "board.png", type: "image/png" }, assets: [], queued: true, status: "QUEUED", qualityTarget: "HIGH", preferredProvider: "veo", startFrameMode: "PREVIOUS_LAST_FRAME", characterVersionIds: ["cv"], locationVersionId: "lv", transitionType: "AUTO", autoMode: true, takes: [] },
  ],
};

test("continuity selects relevant bibles and previous approved final frame", () => {
  const context = buildContinuityContext(project, "s2");
  assert.equal(context.characters[0].character, "Vitus");
  assert.equal(context.location?.location, "Roman Alley");
  assert.equal(context.previousApprovedTake?.id, "t1");
  assert.equal(context.selectedStartFrame?.id, "last");
});

test("provider compiler keeps creative facts and adapts provider instruction", () => {
  const prompt = compilePrompt(project, project.scenes[1], "veo");
  assert.match(prompt, /Vitus/);
  assert.match(prompt, /Roman Alley/);
  assert.match(prompt, /Prioritize identity fidelity/);
});

test("analysis prioritizes official reference, previous frame and storyboard", () => {
  const analysis = analyzeContinuity(project, "s2");
  assert.equal(analysis.transition, "CUT_ON_ACTION");
  assert.deepEqual(analysis.references.map((item) => item.priority), [1, 2, 3]);
  assert.equal(analysis.score, 100);
});

test("auto mode ignores archived character references", () => {
  project.characters[0].versions[0].references.push({ id: "old", name: "old.png", type: "image/png", kind: "ARCHIVE" });
  const analysis = analyzeContinuity(project, "s2");
  assert.equal(analysis.references.some((item) => item.asset.id === "old"), false);
});

test("free-only routing never selects a paid provider", () => {
  const selected = selectProvider({ quality: "HERO", budget: "FREE_ONLY", required: ["START_FRAME"] });
  assert.equal(selected?.id, "vibes");
});
