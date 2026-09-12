"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronLeft, History, Image, Loader2, MessageSquarePlus, Paperclip, Plus, Send, Sparkles, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssistantAction, AssistantAttachment, AssistantMessage, AssistantThread } from "@/lib/assistant-types";
import { activeCharacterVersion, shotCode, type ProductionProject, type ProductionShot } from "@/lib/production";

type Props = {
  open: boolean;
  project: ProductionProject;
  currentShot: ProductionShot;
  surface: "production" | "bible";
  bibleTab: string;
  currentCharacterId?: string;
  onClose: () => void;
  onBeforeSend: () => Promise<void>;
  onAction: (action: AssistantAction) => void;
};

const productionQuestions = ["Check continuity", "Improve prompt", "Best transition?", "Which references?", "What should happen next?"];
const bibleQuestions = ["Is this character configured well?", "Missing references?", "Check character consistency"];

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Project Assistant is unavailable.");
  }
  return response.json() as Promise<T>;
}

function availableAttachments(project: ProductionProject, shot?: ProductionShot): AssistantAttachment[] {
  if (!shot) return [];
  const items: AssistantAttachment[] = [];
  if (shot.storyboard) items.push({ ...shot.storyboard, label: "Current Storyboard" });
  const approved = shot.takes.find((take) => take.id === shot.approvedTakeId);
  if (approved?.outputAsset) items.push({ ...approved.outputAsset, label: "Current Video" });
  if (approved?.finalFrame) items.push({ ...approved.finalFrame, label: "Current Last Frame" });
  const index = project.scenes.findIndex((item) => item.id === shot.id);
  const previous = project.scenes[index - 1];
  const previousTake = previous?.takes.find((take) => take.id === previous.approvedTakeId && take.status === "APPROVED");
  if (previousTake?.finalFrame) items.push({ ...previousTake.finalFrame, label: `Previous Frame ${shotCode(previous)}` });
  for (const character of project.characters) {
    const version = activeCharacterVersion(character);
    if (!version || !shot.characterVersionIds.some((id) => character.versions.some((item) => item.id === id))) continue;
    for (const reference of version.references.filter((asset) => asset.kind !== "ARCHIVE").slice(0, 3)) items.push({ ...reference, label: `${character.name} · ${reference.kind || "Reference"}` });
  }
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export function ProjectAssistant({ open, project, currentShot, surface, bibleTab, currentCharacterId, onClose, onBeforeSend, onAction }: Props) {
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadId, setThreadId] = useState<string>();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [message, setMessage] = useState("");
  const [scopeShotId, setScopeShotId] = useState(currentShot.id);
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<AssistantAction>();
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const scopedShot = scopeShotId === "entire" || scopeShotId === "character" ? undefined : project.scenes.find((shot) => shot.id === scopeShotId) || currentShot;
  const assetOptions = useMemo(() => availableAttachments(project, scopedShot), [project, scopedShot]);
  const quickQuestions = surface === "production" ? productionQuestions : bibleQuestions;

  useEffect(() => { if (open) setScopeShotId(surface === "bible" && bibleTab === "characters" && currentCharacterId ? "character" : surface === "bible" ? "entire" : currentShot.id); }, [open, currentShot.id, surface, bibleTab, currentCharacterId]);
  useEffect(() => {
    if (!open) return;
    api<{ threads: AssistantThread[]; messages: AssistantMessage[] }>("/api/assistant/chat?projectId=main")
      .then((data) => setThreads(data.threads)).catch((reason) => setError(reason.message));
  }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function openThread(id: string) {
    setBusy(true); setError("");
    try {
      const data = await api<{ threads: AssistantThread[]; messages: AssistantMessage[] }>(`/api/assistant/chat?projectId=main&threadId=${encodeURIComponent(id)}`);
      setThreadId(id); setMessages(data.messages); setThreads(data.threads); setHistoryOpen(false);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  function newChat() { setThreadId(undefined); setMessages([]); setMessage(""); setAttachments([]); setHistoryOpen(false); setError(""); }

  async function send(text = message) {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true); setError(""); setMessage("");
    const optimistic: AssistantMessage = { id: crypto.randomUUID(), role: "user", content: clean, attachments, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    try {
      await onBeforeSend();
      const result = await api<{ threadId: string; message: AssistantMessage; userMessage: AssistantMessage }>("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "main", sceneId: scopedShot?.id, shotId: scopedShot?.id, characterId: scopeShotId === "character" ? currentCharacterId : undefined, threadId, message: clean, attachments }) });
      setThreadId(result.threadId);
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), result.userMessage, result.message]);
      setAttachments([]);
      const history = await api<{ threads: AssistantThread[] }>("/api/assistant/chat?projectId=main");
      setThreads(history.threads);
    } catch (reason) {
      setError((reason as Error).message);
    } finally { setBusy(false); }
  }

  function toggleAttachment(asset: AssistantAttachment) {
    setAttachments((current) => current.some((item) => item.id === asset.id) ? current.filter((item) => item.id !== asset.id) : [...current, asset].slice(-6));
  }

  const selectedCharacter = project.characters.find((character) => character.id === currentCharacterId);
  const contextLabel = scopeShotId === "character" && selectedCharacter ? `${project.title} / ${selectedCharacter.name}` : scopeShotId === "entire" ? `${project.title} / Entire Project` : `${project.title} / Scene ${String(scopedShot?.sceneNumber || 1).padStart(2, "0")} / Shot ${scopedShot ? shotCode(scopedShot) : "—"}`;
  return <aside className={`project-assistant ${open ? "open" : ""}`} aria-hidden={!open}>
    <header className="assistant-head">
      <div><span><Bot/></span><div><small>PROJECT ASSISTANT</small><strong>{project.title}</strong></div></div>
      <div><button onClick={() => setHistoryOpen((value) => !value)} aria-label="Conversation history"><History/></button><button onClick={newChat} aria-label="New chat"><MessageSquarePlus/></button><button onClick={onClose} aria-label="Close assistant"><X/></button></div>
    </header>
    <div className="assistant-context">
      <small>CONTEXT</small>
      <Select value={scopeShotId} onValueChange={(value) => { setScopeShotId(value); setAttachments([]); }}><SelectTrigger aria-label="Assistant context"><SelectValue/></SelectTrigger><SelectContent>{selectedCharacter && <SelectItem value="character">{project.title} / {selectedCharacter.name}</SelectItem>}<SelectItem value="entire">{project.title} / Entire Project</SelectItem>{project.scenes.map((shot) => <SelectItem key={shot.id} value={shot.id}>Scene {String(shot.sceneNumber).padStart(2, "0")} / Shot {shotCode(shot)}</SelectItem>)}</SelectContent></Select>
      <span>{contextLabel}</span>
    </div>
    {historyOpen ? <div className="assistant-history"><div><button onClick={() => setHistoryOpen(false)}><ChevronLeft/>Back</button><Button onClick={newChat}><Plus/>New Chat</Button></div><h3>Project Assistant History</h3>{threads.length ? threads.map((thread) => <button key={thread.id} className={thread.id === threadId ? "active" : ""} onClick={() => openThread(thread.id)}><strong>{thread.title}</strong><span>{thread.shotId ? project.scenes.find((shot) => shot.id === thread.shotId)?.title || "Shot thread" : "General"}</span></button>) : <p>No conversations in this project yet.</p>}</div> : <>
      <div className="assistant-messages">
        {!messages.length && <div className="assistant-welcome"><Sparkles/><h3>Ask about this project</h3><p>I’ll check the current shot, Project Bible, continuity, references and generation history before answering.</p></div>}
        {messages.map((item) => <article key={item.id} className={`assistant-message ${item.role}`}><div><span>{item.role === "assistant" ? "ASSISTANT" : "YOU"}</span>{item.mode && <em>{item.mode}</em>}</div><p>{item.content}</p>{item.attachments?.length ? <div className="message-assets">{item.attachments.map((asset) => <span key={asset.id}><Image/>{asset.label}</span>)}</div> : null}{item.actions?.length ? <div className="assistant-actions">{item.actions.map((action) => <button key={action.id} onClick={() => setPendingAction(action)}>{action.label}</button>)}</div> : null}</article>)}
        {busy && <div className="assistant-thinking"><Loader2 className="spin"/>Checking project context…</div>}
        <div ref={endRef}/>
      </div>
      <div className="assistant-quick">{quickQuestions.map((question) => <button key={question} onClick={() => send(question)} disabled={busy}>{question}</button>)}</div>
      <div className="assistant-composer">
        {attachments.length > 0 && <div className="attached-assets">{attachments.map((asset) => <button key={asset.id} onClick={() => toggleAttachment(asset)}><Paperclip/>{asset.label}<X/></button>)}</div>}
        {error && <p className="assistant-error">{error}</p>}
        <div>
          <DropdownMenu><DropdownMenuTrigger asChild><button className="attach-button" aria-label="Attach current asset"><Plus/></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" className="assistant-attachment-menu"><DropdownMenuLabel>Attach current asset</DropdownMenuLabel><DropdownMenuSeparator/>{assetOptions.length ? assetOptions.map((asset) => <DropdownMenuCheckboxItem key={asset.id} checked={attachments.some((item) => item.id === asset.id)} onCheckedChange={() => toggleAttachment(asset)}><Paperclip/>{asset.label}</DropdownMenuCheckboxItem>) : <DropdownMenuLabel>No current assets available</DropdownMenuLabel>}</DropdownMenuContent></DropdownMenu>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={surface === "bible" ? `Ask about ${bibleTab}…` : `Ask about shot ${shotCode(scopedShot || currentShot)}…`} rows={2}/>
          <button className="send-button" onClick={() => send()} disabled={!message.trim() || busy} aria-label="Send"><Send/></button>
        </div>
        <small>Project context is attached automatically · Ctrl/⌘ J</small>
      </div>
    </>}
    <AlertDialog open={Boolean(pendingAction)} onOpenChange={(next) => !next && setPendingAction(undefined)}><AlertDialogContent className="assistant-confirm"><AlertDialogHeader><AlertDialogTitle>Confirm project action</AlertDialogTitle><AlertDialogDescription>{pendingAction?.description}</AlertDialogDescription></AlertDialogHeader>{pendingAction?.type === "REPLACE_PROMPT" && <pre>{pendingAction.payload?.prompt}</pre>}<AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (pendingAction) onAction(pendingAction); setPendingAction(undefined); }}><Check/>Apply</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </aside>;
}
