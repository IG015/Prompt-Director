(() => {
  const bridge = globalThis.PromptDirectorBridge ||= {};
  const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0;
  const label = (element) => [element?.textContent, element?.getAttribute?.("aria-label")].filter(Boolean).join(" ").trim();
  const error = (stage, errorCode, message, details = {}) => Object.assign(new Error(message), { stage, errorCode, details });
  const verifiedSelections = new WeakSet();
  const inMemorySnapshots = new Map();

  function normalized(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function waitFor(find, { timeoutMs = 15000, stage, errorCode, message, details = {} }) {
    const immediate = find();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => { const result = find(); if (result) { clearTimeout(timeout); observer.disconnect(); resolve(result); } });
      const timeout = setTimeout(() => { observer.disconnect(); reject(error(stage, errorCode, message, { ...details, timeoutMs })); }, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled", "aria-selected", "aria-checked", "aria-pressed", "data-state", "checked", "class", "style", "src"] });
    });
  }

  function visibleDialogs() {
    return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[data-radix-dialog-content]')].filter(visible);
  }

  function deepQueryAll(root, selector) {
    const results = [...root.querySelectorAll(selector)];
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) results.push(...deepQueryAll(element.shadowRoot, selector));
    }
    return results;
  }

  function inputSummary(input) {
    const style = input.ownerDocument.defaultView.getComputedStyle(input);
    return {
      accept: input.accept || null,
      multiple: input.multiple,
      disabled: input.disabled,
      hidden: input.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || input.getClientRects().length === 0,
      outerHTML: input.outerHTML.replace(/\s+/g, " ").replace(/value="[^"]*"/gi, 'value=""').slice(0, 320)
    };
  }

  function deepFindFileInputs() {
    const selector = 'input[type="file"],input[accept*="image" i]';
    const entries = [];
    const normal = [];
    const shadow = [];
    const iframeDiagnostics = [];
    const seen = new Set();
    const scanRoot = (root, context, frameElement = null) => {
      for (const input of root.querySelectorAll(selector)) {
        if (input.tagName !== "INPUT" || seen.has(input)) continue;
        seen.add(input);
        const entry = { input, context, frameElement };
        entries.push(entry);
        if (context === "shadow") shadow.push(inputSummary(input));
        else if (context === "document") normal.push(inputSummary(input));
      }
      for (const host of root.querySelectorAll("*")) {
        if (host.shadowRoot) scanRoot(host.shadowRoot, "shadow", frameElement);
      }
      for (const frame of root.querySelectorAll("iframe")) {
        const item = { src: frame.getAttribute("src") || null, sameOrigin: false, fileInputs: 0 };
        try {
          const frameDocument = frame.contentDocument;
          if (frameDocument) {
            item.sameOrigin = true;
            const before = entries.length;
            scanRoot(frameDocument, "iframe", frame);
            item.fileInputs = entries.length - before;
          }
        } catch {}
        iframeDiagnostics.push(item);
      }
    };
    scanRoot(document, "document");
    return { entries, diagnostic: { fileInputsNormal: normal, fileInputsInsideShadowRoots: shadow, iframes: iframeDiagnostics } };
  }

  function belongsToModal(entry, modal) {
    if (modal.contains(entry.input) || (entry.frameElement && modal.contains(entry.frameElement))) return true;
    let current = entry.input;
    while (current) {
      if (current === modal) return true;
      const root = current.getRootNode?.();
      current = root?.host || current.parentElement;
    }
    return false;
  }

  function uploadModalTextMatches(element) {
    const text = normalized(label(element));
    return /carregar imagens|upload images|upload media|adicionar imagens/.test(text)
      || (/\b(carregar|upload)\b/.test(text) && /drag and drop|arraste|png|jpe?g|webp|imagens?/.test(text));
  }

  function findUploadModal() {
    const semantic = visibleDialogs().find(uploadModalTextMatches);
    if (semantic) return semantic;
    const markers = [...document.querySelectorAll("h1,h2,h3,[role='heading'],p,span,div")]
      .filter((element) => visible(element) && /^(carregar imagens|upload images|upload media)$/.test(normalized(label(element))));
    for (const marker of markers) {
      const semanticParent = marker.closest('[role="dialog"],[aria-modal="true"],[data-radix-dialog-content],[class*="modal" i],[class*="dialog" i]');
      if (semanticParent && visible(semanticParent) && uploadModalTextMatches(semanticParent)) return semanticParent;
      let candidate = marker.parentElement;
      for (let depth = 0; candidate && depth < 8; depth += 1, candidate = candidate.parentElement) {
        const hasUploadButton = button(candidate, /^(carregar|upload)$/i);
        const hasDropArea = /drag and drop|arraste|png|jpe?g|webp/.test(normalized(label(candidate)));
        if (visible(candidate) && hasUploadButton && hasDropArea) return candidate;
      }
    }
    return null;
  }

  function findAssetPicker() {
    return visibleDialogs()
      .find((dialog) => /conteudos? de pasta|folder contents/.test(normalized(label(dialog))));
  }

  function findDropzone(uploadModal) {
    if (!uploadModal) return null;
    const candidates = deepQueryAll(uploadModal, '[data-testid*="drop" i],[class*="dropzone" i],[class*="drop-zone" i],[role="button"],label,[tabindex],button,div');
    const marker = candidates
      .filter((element) => visible(element) && /click to add or drag and drop media|drag and drop|arraste|clique para adicionar/.test(normalized(label(element))))
      .sort((left, right) => left.children.length - right.children.length || label(left).length - label(right).length)[0];
    return marker?.closest('[data-testid*="drop" i],[class*="dropzone" i],[class*="drop-zone" i],[role="button"],label,[tabindex]') || marker || null;
  }

  function findUploadFileInput(uploadModal, search = deepFindFileInputs()) {
    if (!uploadModal) return null;
    const direct = search.entries.find((entry) => !entry.input.disabled && belongsToModal(entry, uploadModal));
    if (direct) return direct.input;
    for (const uploadLabel of deepQueryAll(uploadModal, "label[for]")) {
      const target = document.getElementById(uploadLabel.htmlFor);
      if (target?.tagName === "INPUT" && !target.disabled && target.matches('input[type="file"],input[accept*="image" i]')) return target;
    }
    return null;
  }

  const findReferenceFileInput = findUploadFileInput;

  function detectVibesReferenceState() {
    const dialogs = visibleDialogs();
    const initialFramePicker = bridge.initialFrame?.findPicker?.() || null;
    if (initialFramePicker) return { state: "INITIAL_FRAME_PICKER", initialFramePicker, assetPicker: null, uploadModal: null, editor: null, dialogsFound: dialogs.length, fileInputsFound: initialFramePicker.querySelectorAll('input[type="file"],input[accept*="image" i]').length };
    const assetPicker = dialogs.find((dialog) => /conteudos? de pasta|folder contents/.test(normalized(label(dialog)))) || null;
    if (assetPicker) return { state: "ASSET_PICKER", initialFramePicker: null, assetPicker, uploadModal: null, editor: null, dialogsFound: dialogs.length, fileInputsFound: assetPicker.querySelectorAll('input[type="file"],input[accept*="image" i],input[multiple]').length };
    const uploadModal = findUploadModal();
    if (uploadModal) return { state: "UPLOAD_MODAL", initialFramePicker: null, assetPicker: null, uploadModal, editor: null, dialogsFound: dialogs.length, fileInputsFound: deepQueryAll(uploadModal, 'input[type="file"],input[accept*="image" i],input[multiple]').length };
    const editor = bridge.prompt?.findEditor?.() || null;
    if (editor) return { state: "EDITOR", initialFramePicker: null, assetPicker: null, uploadModal: null, editor, dialogsFound: dialogs.length, fileInputsFound: 0 };
    return { state: "UNKNOWN", initialFramePicker: null, assetPicker: null, uploadModal: null, editor: null, dialogsFound: dialogs.length, fileInputsFound: 0 };
  }

  function snapshotKey(context) {
    return [context?.project?.id, context?.shot?.sceneId, context?.shot?.shotId].filter(Boolean).join(":") || "current";
  }

  function rememberSnapshot(context, cards) {
    const snapshot = cards.map(({ key, assetId = "", thumbnailSrc, label: cardLabel }) => ({ key, assetId, thumbnailSrc, label: cardLabel }));
    inMemorySnapshots.set(snapshotKey(context), snapshot);
    try { sessionStorage.setItem(`pd-reference-snapshot:${snapshotKey(context)}`, JSON.stringify(snapshot)); } catch {}
    return snapshot;
  }

  function recalledSnapshot(context) {
    const key = snapshotKey(context);
    if (inMemorySnapshots.has(key)) return inMemorySnapshots.get(key);
    try { return JSON.parse(sessionStorage.getItem(`pd-reference-snapshot:${key}`) || "[]"); } catch { return []; }
  }

  function forgetSnapshot(context) {
    const key = snapshotKey(context);
    inMemorySnapshots.delete(key);
    try { sessionStorage.removeItem(`pd-reference-snapshot:${key}`); } catch {}
  }

  function button(root, pattern) {
    return [...root.querySelectorAll('button,[role="button"]')].filter(visible).find((element) => pattern.test(label(element)));
  }

  function selectedIndicator(element) {
    if (element instanceof HTMLInputElement && /checkbox|radio/.test(element.type) && element.checked) return true;
    if (["true", "checked", "selected", "on", "active"].includes(normalized(element.getAttribute("aria-selected")))) return true;
    if (["true", "checked", "selected", "on", "active"].includes(normalized(element.getAttribute("aria-checked")))) return true;
    if (normalized(element.getAttribute("aria-pressed")) === "true") return true;
    if (["checked", "selected", "on", "active"].includes(normalized(element.getAttribute("data-state")))) return true;
    if (normalized(element.getAttribute("data-selected")) === "true") return true;
    if (/(^|\s)(is-selected|selected|checked|active)(\s|$)/i.test(String(element.className || ""))) return true;
    return Boolean(element.querySelector('input[type="checkbox"]:checked,input[type="radio"]:checked,[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"],[data-state="checked"],[data-state="selected"]'));
  }

  function cardKey(element, thumbnailSrc, cardLabel) {
    const identity = element.getAttribute("data-asset-id") || element.getAttribute("data-id") || element.id || thumbnailSrc;
    return identity || `${cardLabel}|${[...element.parentElement?.children || []].indexOf(element)}`;
  }

  function discoverAssetCards(root = findAssetPicker()) {
    if (!root) return [];
    const candidates = [];
    for (const thumbnail of root.querySelectorAll('img,[style*="background-image"]')) {
      const element = thumbnail.closest('[data-asset-id],[data-id],[role="option"],[role="checkbox"],[aria-selected],[aria-checked],[data-state],li,[data-testid*="asset" i],[class*="asset" i],[class*="card" i],[class*="item" i]');
      if (element && element !== root && visible(element) && !candidates.includes(element)) candidates.push(element);
    }
    if (!candidates.length) {
      for (const element of root.querySelectorAll('[role="option"],[role="checkbox"],[aria-selected],[aria-checked],[data-asset-id],[data-testid*="asset" i]')) {
        if (element !== root && visible(element) && !candidates.includes(element)) candidates.push(element);
      }
    }
    return candidates.map((element) => {
      const thumbnail = element.querySelector("img");
      const thumbnailSrc = thumbnail?.currentSrc || thumbnail?.src || element.style.backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1] || "";
      const cardLabel = label(element) || thumbnail?.alt || thumbnail?.title || "";
      const assetId = element.getAttribute("data-asset-id") || element.getAttribute("data-id") || element.id || "";
      return { element, assetId, selected: selectedIndicator(element), thumbnailSrc, label: cardLabel, key: cardKey(element, thumbnailSrc, cardLabel) };
    });
  }

  function selectionControl(card) {
    const explicit = card.element.querySelector('input[type="checkbox"],input[type="radio"],[role="checkbox"],[aria-checked],[aria-selected],[aria-pressed]');
    if (explicit && visible(explicit)) return explicit;
    if (card.element.matches('[role="option"],[role="checkbox"],[aria-selected],[aria-checked],[data-state]')) return card.element;
    const buttons = [...card.element.querySelectorAll('button,[role="button"]')].filter(visible);
    const selectable = buttons.find((element) => !/chevron|detail|detalhe|next|seguinte|abrir/i.test(`${label(element)} ${element.getAttribute("aria-label") || ""}`));
    return selectable || card.element;
  }

  function selectionSignature(card) {
    const control = selectionControl(card);
    return [
      card.element.className,
      card.element.getAttribute("aria-selected"),
      card.element.getAttribute("aria-checked"),
      card.element.getAttribute("data-state"),
      control?.className,
      control?.getAttribute?.("aria-selected"),
      control?.getAttribute?.("aria-checked"),
      control?.getAttribute?.("aria-pressed"),
      control?.getAttribute?.("data-state")
    ].join("|");
  }

  async function setCardSelected(card, desired) {
    const current = selectedIndicator(card.element);
    if (current === desired) return true;
    const control = selectionControl(card);
    if (!control || !visible(control)) return false;
    control.click();
    try {
      await waitFor(() => {
        if (selectedIndicator(card.element) === desired) return true;
        return null;
      }, { timeoutMs: 4000, stage: "ASSET_SELECTION", errorCode: "ASSET_SELECTION_FAILED", message: "Meta Vibes did not confirm asset selection.", details: { label: card.label, thumbnailSrc: card.thumbnailSrc, desired } });
      if (desired) verifiedSelections.add(card.element); else verifiedSelections.delete(card.element);
      return true;
    } catch {
      return false;
    }
  }

  function sameAssetUrl(left, right) {
    try {
      const a = new URL(left, location.href); const b = new URL(right, location.href);
      return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
    } catch { return left && right && left === right; }
  }

  function looksRecent(card) {
    const value = normalized(card.label);
    if (/\b(agora|just now|now|segundos?|seconds?|minutos?|minutes?)\b/.test(value)) return true;
    if (/\b\d+\s*(dias?|days?|semanas?|weeks?|meses?|months?|anos?|years?)\b/.test(value)) return false;
    return false;
  }

  function identifyUploadedAssets(cards, before, references, uploadPerformed) {
    const expected = references.length;
    const beforeKeys = new Set(before.map((card) => card.key));
    const newCards = cards.filter((card) => card.key && !beforeKeys.has(card.key));
    if (uploadPerformed && newCards.length === expected) return { cards: newCards, strategy: "new-identifiers", newAssetsDetected: newCards.length };
    const matched = [];
    for (const reference of references) {
      const name = normalized(reference.name);
      const candidates = cards.filter((card) => !matched.includes(card) && (sameAssetUrl(card.thumbnailSrc, reference.assetUrl)
        || (name && normalized(card.label) === name)));
      if (candidates.length !== 1) return { cards: [], strategy: "unresolved", newAssetsDetected: 0 };
      matched.push(candidates[0]);
    }
    if (matched.length === expected) return { cards: matched, strategy: "reference-identity", newAssetsDetected: matched.length };
    return { cards: [], strategy: "unresolved", newAssetsDetected: 0 };
  }

  async function selectUploadedAssets(picker, before, references, report, { uploadPerformed = false, stateDiagnostic = {} } = {}) {
    const cards = await waitFor(() => {
      const discovered = discoverAssetCards(picker);
      return discovered.length ? discovered : null;
    }, { timeoutMs: 30000, stage: "ASSETS_DISCOVERED", errorCode: "ASSETS_NOT_FOUND", message: "No visual assets were found in the Meta Vibes picker.", details: { expected: references.length } });
    await report("ASSETS_DISCOVERED", "uploading_references", { expected: references.length, found: cards.length });
    const identified = identifyUploadedAssets(cards, before, references, uploadPerformed);
    if (identified.cards.length !== references.length) throw error("REFERENCE_UPLOAD", "UPLOADED_ASSETS_NOT_DETECTED", "The current generation references were not detected in Meta Vibes.", { expectedReferences: references.length, newAssetsDetected: identified.newAssetsDetected, existingAssets: before.length || cards.length, detectedState: "ASSET_PICKER", dialogsFound: stateDiagnostic.dialogsFound || visibleDialogs().length, fileInputsFound: stateDiagnostic.fileInputsFound || 0, strategy: identified.strategy });
    const targetKeys = new Set(identified.cards.map((card) => card.key));
    for (const card of cards) {
      if (!targetKeys.has(card.key) && card.selected && !await setCardSelected(card, false)) throw error("ASSET_SELECTION", "ASSET_SELECTION_FAILED", "An old Meta Vibes asset could not be deselected.", { label: card.label, thumbnailSrc: card.thumbnailSrc, desired: false });
    }
    for (const card of identified.cards) {
      if (!await setCardSelected(card, true)) throw error("ASSET_SELECTION", "ASSET_SELECTION_FAILED", "A newly uploaded Meta Vibes asset could not be selected.", { label: card.label, thumbnailSrc: card.thumbnailSrc, strategy: identified.strategy, desired: true });
    }
    const refreshed = discoverAssetCards(picker);
    const selectedCount = refreshed.filter((card) => card.selected).length;
    if (selectedCount !== references.length) throw error("ASSET_SELECTION", "ASSET_SELECTION_COUNT_MISMATCH", "Meta Vibes selected a different number of assets than expected.", { expected: references.length, discovered: cards.length, selected: selectedCount });
    await report("ASSETS_SELECTED", "uploading_references", { expected: references.length, selected: selectedCount, strategy: identified.strategy });
    return selectedCount;
  }

  function findAddAssetsButton(picker) {
    const candidates = [...picker.querySelectorAll('button,[role="button"]')].filter(visible);
    const enabled = candidates.filter((element) => element.getAttribute("aria-disabled") !== "true" && !element.disabled);
    return candidates.find((element) => /projeto|project/.test(normalized(label(element))))
      || enabled.find((element) => /primary|blue|accent/.test(`${element.getAttribute("data-variant") || ""} ${element.className || ""}`))
      || enabled.at(-1)
      || null;
  }

  async function reportReferenceState(detected, report, expectedReferences) {
    await report("VIBES_STATE", "uploading_references", { detectedState: detected.state, dialogsFound: detected.dialogsFound, fileInputsFound: detected.fileInputsFound, expectedReferences });
  }

  async function locateReferenceState(report, expectedReferences) {
    let detected = detectVibesReferenceState();
    await reportReferenceState(detected, report, expectedReferences);
    if (["UPLOAD_MODAL", "ASSET_PICKER", "INITIAL_FRAME_PICKER"].includes(detected.state)) return detected;
    const opener = button(document, /add media|add reference|upload|carregar|adicionar (imagem|referência)|anexar/i);
    if (!opener) throw error("REFERENCES_UPLOADING", "UPLOAD_TRIGGER_NOT_FOUND", "Meta Vibes reference control was not found.", { detectedState: detected.state, dialogsFound: detected.dialogsFound, fileInputsFound: detected.fileInputsFound, expectedReferences });
    opener.click();
    detected = await waitFor(() => {
      const current = detectVibesReferenceState();
      return ["UPLOAD_MODAL", "ASSET_PICKER", "INITIAL_FRAME_PICKER"].includes(current.state) ? current : null;
    }, { timeoutMs: 20000, stage: "REFERENCES_UPLOADING", errorCode: "REFERENCE_FLOW_NOT_FOUND", message: "Meta Vibes did not open its reference flow.", details: { detectedState: detected.state, expectedReferences } });
    await reportReferenceState(detected, report, expectedReferences);
    return detected;
  }

  async function referenceFile(reference) {
    const result = await chrome.runtime.sendMessage({ version: 1, type: "PD_PANEL_GET_ASSET", assetId: reference.id });
    const asset = result?.asset;
    if (!result?.ok || !asset?.mimeType?.startsWith("image/") || !asset.dataUrl?.startsWith("data:"))
      throw error("ASSETS_FETCHING", "SESSION_ASSET_NOT_FOUND", "Resolved image unavailable in session store.", { referenceId: reference.id });
    const binary = atob(asset.dataUrl.slice(asset.dataUrl.indexOf(",") + 1));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const file = new File([bytes], asset.name || reference.name, { type: asset.mimeType });
    if (!file.size || !file.type) throw error("ASSETS_FETCHING", "INVALID_ASSET_FILE", "Image file is empty or has no MIME type.");
    return file;
  }

  function selectUploadReferences(references, limit = 4) {
    const items = Array.isArray(references) ? references : [];
    const descriptor = (reference) => normalized(`${reference.type || ""} ${reference.role || ""} ${reference.name || ""}`);
    const priority = (reference) => {
      const value = descriptor(reference);
      if (/storyboard|current frame|fotograma atual/.test(value)) return 0;
      if (/scaeva/.test(value) && /official|identity|oficial/.test(value)) return 1;
      if (/vitus/.test(value) && /official|identity|oficial/.test(value)) return 2;
      if (/vitus/.test(value) && /hair|cabelo/.test(value)) return 3;
      return 10;
    };
    return items.map((reference, index) => ({ reference, index, priority: priority(reference) }))
      .sort((left, right) => left.priority - right.priority || left.index - right.index)
      .slice(0, limit)
      .map(({ reference }) => reference);
  }

  function uploadEvidence(modal, files, before) {
    if (!modal?.isConnected || !visible(modal)) return null;
    const previewSelector = "img,[data-testid*='preview' i],[class*='preview' i],[class*='thumbnail' i],[style*='background-image']";
    const previewCount = deepQueryAll(modal, previewSelector).filter(visible).length;
    const text = normalized(label(modal));
    const filenames = files.filter((file) => text.includes(normalized(file.name))).length;
    const countMatch = text.match(/(?:^|\s)(\d+)\s*(?:\/\s*12|imagens?|images?|arquivos?|files?)/);
    const counter = countMatch ? Number(countMatch[1]) : 0;
    const currentButton = button(modal, /^(carregar|upload)$/i);
    const buttonEnabled = Boolean(currentButton && !currentButton.disabled && currentButton.getAttribute("aria-disabled") !== "true");
    const contentChanged = modal.querySelectorAll("*").length !== before.elementCount || text !== before.text;
    const buttonBecameEnabled = before.buttonEnabled === false && buttonEnabled;
    if (previewCount >= before.previewCount + files.length || (contentChanged && (filenames === files.length || counter >= files.length)) || buttonBecameEnabled) {
      return { previewCount, filenames, counter, buttonEnabled, contentChanged };
    }
    return null;
  }

  async function waitForUploadReady(uploadModal, files, before) {
    return waitFor(() => uploadEvidence(uploadModal, files, before), {
      timeoutMs: 30000,
      stage: "REFERENCES_UPLOADING",
      errorCode: "UPLOAD_PREVIEW_TIMEOUT",
      message: "Meta Vibes did not show the attached image previews.",
      details: { expectedFiles: files.length, initialPreviews: before.previewCount }
    });
  }

  function setInputFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return transfer.files.length;
  }

  async function filesForMainWorld(files) {
    return Promise.all(files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return { name: file.name, type: file.type, base64: btoa(binary) };
    }));
  }

  async function assignFilesInMainWorld(files) {
    const response = await chrome.runtime.sendMessage({ version: 1, type: "PD_MAIN_WORLD_UPLOAD", files: await filesForMainWorld(files) });
    if (!response?.ok) throw error("REFERENCES_UPLOADING", "MAIN_WORLD_UPLOAD_FAILED", "Meta Vibes did not accept the files in the page context.", { reason: response?.errorCode || response?.message || "MAIN_WORLD_EXECUTION_FAILED", results: response?.details?.results || [] });
    return response;
  }

  function dispatchFileDrop(dropzone, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    for (const type of ["dragenter", "dragover", "drop"]) {
      dropzone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
    }
  }

  async function waitForReactionAttempt(uploadModal, files, before, timeoutMs = 5000) {
    try {
      return await waitFor(() => uploadEvidence(uploadModal, files, before), { timeoutMs, stage: "REFERENCES_UPLOADING", errorCode: "VIBES_DID_NOT_REACT_TO_FILE_INPUT", message: "Meta Vibes did not react to the assigned files.", details: { expectedFiles: files.length } });
    } catch {
      return null;
    }
  }

  async function uploadFilesInModal(uploadModal, references, report, { limit = 4 } = {}) {
    const selectedReferences = selectUploadReferences(references, limit);
    await report("UPLOAD_MODAL_FOUND", "uploading_references", { expectedReferences: selectedReferences.length, modalTitle: label(uploadModal).slice(0, 80) });
    const beforeSearch = deepFindFileInputs();
    const dropzone = findDropzone(uploadModal);
    const diagnostic = {
      ...beforeSearch.diagnostic,
      buttons: deepQueryAll(uploadModal, 'button,[role="button"]').filter(visible).map((element) => ({ label: label(element).slice(0, 80), disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true") })),
      dropzones: dropzone ? [{ label: label(dropzone).slice(0, 120), role: dropzone.getAttribute("role"), testId: dropzone.getAttribute("data-testid") }] : []
    };
    console.info("VIBES_UPLOAD_DOM_DIAGNOSTIC", diagnostic);
    await report("VIBES_UPLOAD_DOM_DIAGNOSTIC", "uploading_references", diagnostic);
    const fileInput = findUploadFileInput(uploadModal, beforeSearch);
    if (fileInput) await report("FILE_INPUT_FOUND", "uploading_references", inputSummary(fileInput));
    await report("ASSETS_FETCH_STARTED", "uploading_references", { referenceCount: selectedReferences.length, names: selectedReferences.map((item) => item.name) });
    let files;
    try { files = await Promise.all(selectedReferences.map(referenceFile)); }
    catch (cause) {
      if (cause?.errorCode === "ASSET_FETCH_FAILED") throw cause;
      throw error("REFERENCES_UPLOADING", "ASSET_FETCH_FAILED", "One or more Meta Vibes references could not be prepared.", { expectedReferences: selectedReferences.length, cause: cause instanceof Error ? cause.message : String(cause) });
    }
    if (!files.length) throw error("REFERENCES_UPLOADING", "ZERO_FILES_PREPARED", "No reference file could be prepared for Meta Vibes.", { requested: selectedReferences.length });
    await report("FILES_PREPARED", "uploading_references", { count: files.length, files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })) });
    const previewSelector = "img,[data-testid*='preview' i],[class*='preview' i],[class*='thumbnail' i],[style*='background-image']";
    const initialButton = button(uploadModal, /^(carregar|upload)$/i);
    const before = { previewCount: deepQueryAll(uploadModal, previewSelector).filter(visible).length, elementCount: uploadModal.querySelectorAll("*").length, text: normalized(label(uploadModal)), buttonEnabled: Boolean(initialButton && !initialButton.disabled && initialButton.getAttribute("aria-disabled") !== "true") };
    let evidence = null;
    let uploadStrategy = "NOT_STARTED";
    for (const strategy of ["FILE_INPUT", "DRAG_DROP", "MAIN_WORLD"]) {
      try {
        if (strategy === "FILE_INPUT") {
          if (!fileInput || (files.length > 1 && !fileInput.multiple)) continue;
          setInputFiles(fileInput, files);
        } else if (strategy === "DRAG_DROP") {
          if (!dropzone) continue;
          dispatchFileDrop(dropzone, files);
        } else {
          if (fileInput) fileInput.setAttribute("data-pd-upload-target", "true");
          try { await assignFilesInMainWorld(files); }
          finally { fileInput?.removeAttribute("data-pd-upload-target"); }
        }
        evidence = await waitForReactionAttempt(uploadModal, files, before);
        if (evidence) { uploadStrategy = strategy; break; }
      } catch (cause) {
        await report("UPLOAD_ATTEMPT_FAILED", "uploading_references", { strategy, reason: cause.message });
      }
    }
    if (!evidence) throw error("REFERENCES_UPLOADING", "UPLOAD_PREVIEW_TIMEOUT", "Vibes did not show upload evidence after all strategies.", diagnostic);
    await report("UPLOAD_STRATEGY", "uploading_references", { uploadStrategy });
    await report("VIBES_UI_REACTED", "uploading_references", { fileCount: files.length, ...evidence });
    await report("UPLOAD_READY", "uploading_references", { fileCount: files.length, ...evidence });
    const uploadButton = button(uploadModal, /^(carregar|upload)$/i);
    if (!uploadButton) throw error("REFERENCES_UPLOADING", "UPLOAD_BUTTON_NOT_FOUND", "Meta Vibes upload button was not found.", { modalTitle: label(uploadModal).slice(0, 80), fileCount: files.length });
    if (uploadButton.disabled || uploadButton.getAttribute("aria-disabled") === "true") throw error("REFERENCES_UPLOADING", "UPLOAD_BUTTON_DISABLED", "Meta Vibes upload button is disabled.", { label: label(uploadButton), fileCount: files.length });
    uploadButton.click();
    await report("UPLOAD_BUTTON_CLICKED", "uploading_references", { fileCount: files.length, buttonLabel: label(uploadButton) });
    await waitFor(() => {
      if (!uploadModal.isConnected || !visible(uploadModal)) return true;
      return findUploadModal() !== uploadModal ? true : null;
    }, { timeoutMs: 30000, stage: "REFERENCES_UPLOADING", errorCode: "UPLOAD_CONFIRMATION_TIMEOUT", message: "Meta Vibes did not advance after the upload was confirmed.", details: { fileCount: files.length } });
    await report("UPLOAD_CONFIRMED", "uploading_references", { fileCount: files.length });
    return { references: selectedReferences, files };
  }

  async function finishAssetPicker(picker, before, references, report, stateDiagnostic, context, uploadPerformed) {
    await report("ASSET_PICKER_OPENED", "uploading_references", { title: label(picker).slice(0, 120) });
    const selectedCount = await selectUploadedAssets(picker, before, references, report, { uploadPerformed, stateDiagnostic });
    const addButton = findAddAssetsButton(picker);
    if (!addButton) throw error("ASSETS_ADDED_TO_PROJECT", "ADD_TO_PROJECT_BUTTON_NOT_FOUND", "Meta Vibes add-to-project button was not found.", { selectedCount });
    if (addButton.disabled || addButton.getAttribute("aria-disabled") === "true") throw error("ASSETS_ADDED_TO_PROJECT", "ADD_TO_PROJECT_BUTTON_DISABLED", "Meta Vibes add-to-project button is disabled.", { selectedCount, label: label(addButton) });
    addButton.click();
    await waitFor(() => !picker.isConnected || !visible(picker) || bridge.initialFrame?.findPicker?.() || null, { timeoutMs: 30000, stage: "ASSETS_ADDED_TO_PROJECT", errorCode: "ASSET_PICKER_DID_NOT_CLOSE", message: "Meta Vibes asset picker did not close after confirmation.", details: { selectedCount } });
    await report("ASSETS_ADDED_TO_PROJECT", "uploading_references", { selectedCount, buttonLabel: label(addButton) });
    const destination = await waitFor(() => {
      const initialFramePicker = bridge.initialFrame?.findPicker?.();
      if (initialFramePicker) return { state: "INITIAL_FRAME_PICKER", element: initialFramePicker };
      const editor = bridge.prompt?.findEditor?.();
      return editor ? { state: "EDITOR", element: editor } : null;
    }, { timeoutMs: 30000, stage: "EDITOR_RETURNED", errorCode: "EDITOR_DID_NOT_RETURN", message: "Meta Vibes did not show the initial-frame picker or return to the editor." });
    if (destination.state === "INITIAL_FRAME_PICKER") {
      await bridge.initialFrame.handle(destination.element, context, report);
      forgetSnapshot(context);
      return;
    }
    await report("EDITOR_RETURNED", "configuring", { selectedCount });
    forgetSnapshot(context);
  }

  async function upload(references, report, context = {}) {
    if (!references?.length) throw error("ASSETS_FETCHING", "NO_REFERENCES", "No visual reference was provided.");
    references = selectUploadReferences(references, 1);
    const detected = await locateReferenceState(report, references.length);
    const remembered = recalledSnapshot(context);
    if (detected.state === "INITIAL_FRAME_PICKER") {
      await bridge.initialFrame.handle(detected.initialFramePicker, context, report);
      return;
    }
    if (detected.state === "ASSET_PICKER") {
      await finishAssetPicker(detected.assetPicker, remembered, references, report, detected, context, false);
      return;
    }

    const dialog = detected.uploadModal;
    const assetsBeforeUpload = remembered.length ? remembered : discoverAssetCards(findAssetPicker());
    rememberSnapshot(context, assetsBeforeUpload);
    await uploadFilesInModal(dialog, references, report, { limit: 1 });
    const pickerState = await waitFor(() => {
      const current = detectVibesReferenceState();
      return current.state === "ASSET_PICKER" ? current : null;
    }, { timeoutMs: 30000, stage: "ASSET_PICKER_OPENED", errorCode: "ASSET_PICKER_NOT_FOUND", message: "Meta Vibes folder contents picker did not open." });
    await reportReferenceState(pickerState, report, references.length);
    await finishAssetPicker(pickerState.assetPicker, assetsBeforeUpload, references, report, pickerState, context, true);
  }

  function ingredientButton() {
    return button(document, /ingredientes|ingredients/i);
  }

  function ingredientReferences(context) {
    const frame = bridge.initialFrame.chooseReference(context).reference;
    return (context.references || []).filter((ref) => ref.id !== frame?.id
      && !/storyboard|previous.*frame|initial.*frame|start.*frame|last.*frame/.test(normalized(`${ref.type} ${ref.role} ${ref.name}`)));
  }

  function appliedImages(targets) {
    // Restrict evidence to the composer containing its prompt and Generate control.
    const editor = bridge.prompt?.findEditor();
    const generate = bridge.generator?.findGenerateButton();
    let scope = editor?.parentElement;
    while (scope && scope !== document.body && !scope.contains(generate)) scope = scope.parentElement;
    if (!targets?.length || !scope || scope === document.body) return false;
    const images = [...scope.querySelectorAll('img')].filter((img) => visible(img) && !img.closest('[role="dialog"],[aria-modal="true"],[data-radix-dialog-content]'));
    return targets.every((target) => images.some((img) => target.thumbnailSrc && sameAssetUrl(img.currentSrc || img.src, target.thumbnailSrc)));
  }

  async function sendIngredients(context, report) {
    const references = ingredientReferences(context);
    if (!references.length) throw error("INGREDIENTS", "INGREDIENT_UPLOAD_FAILED", "No ingredient references available.");
    let phase = "INGREDIENT_BUTTON_NOT_FOUND";
    try {
      const opener = ingredientButton();
      if (!opener) throw new Error("Ingredients control not found.");
      opener.click();
      phase = "INGREDIENT_PICKER_NOT_FOUND";
      let picker = await waitFor(() => findAssetPicker() || findUploadModal() || visibleDialogs().find((item) => /ingredientes|ingredients/.test(normalized(label(item)))), { stage: "INGREDIENTS", errorCode: phase, message: "Ingredients picker did not open." });
      const before = discoverAssetCards(picker);
      let identified = identifyUploadedAssets(before, [], references, false);
      let uploaded = false;
      if (identified.cards.length !== references.length) {
        phase = "INGREDIENT_UPLOAD_FAILED";
        let modal = findUploadModal();
        if (!modal) {
          const upload = button(picker, /^(carregar|upload|adicionar imagens|add images)\b/i);
          if (!upload) throw new Error("Upload control not found in ingredients picker.");
          upload.click();
          modal = await waitFor(findUploadModal, { stage: "INGREDIENTS", errorCode: phase, message: "Upload modal did not open." });
        }
        await uploadFilesInModal(modal, references, report, { limit: references.length });
        picker = await waitFor(() => findAssetPicker() || visibleDialogs().find((item) => /ingredientes|ingredients/.test(normalized(label(item)))), { stage: "INGREDIENTS", errorCode: phase, message: "Ingredients library did not return." });
        identified = await waitFor(() => {
          const result = identifyUploadedAssets(discoverAssetCards(picker), before, references, true);
          return result.cards.length === references.length ? result : null;
        }, { stage: "INGREDIENTS", errorCode: phase, message: "Uploaded ingredients could not be identified." });
        uploaded = true;
      }
      phase = "INGREDIENT_CONFIRM_FAILED";
      await selectUploadedAssets(picker, before, references, report, { uploadPerformed: uploaded });
      const confirm = button(picker, /^(adicionar|add|confirmar|confirm|aplicar|apply|concluido|done|selecionar|select)\b/i);
      if (!confirm || confirm.disabled || confirm.getAttribute("aria-disabled") === "true") throw new Error("Ingredients confirmation unavailable.");
      confirm.click();
      await waitFor(() => (!picker.isConnected || !visible(picker)) && appliedImages(identified.cards), { timeoutMs: 30000, stage: "INGREDIENTS", errorCode: phase, message: "Ingredient thumbnails were not confirmed in the editor." });
      await report("INGREDIENTS_APPLIED", "configuring", { count: references.length });
      return identified.cards.map(({ thumbnailSrc }) => ({ thumbnailSrc }));
    } catch (cause) { throw error("INGREDIENTS", phase, cause.message, { cause: cause.errorCode, ...cause.details }); }
  }

  bridge.error = bridge.error || error;
  bridge.uploader = { upload, visibleDialogs, normalized, waitFor, button, referenceFile, detectVibesReferenceState, findUploadModal, findDropzone, deepFindFileInputs, findUploadFileInput, findReferenceFileInput, waitForUploadReady, uploadFilesInModal, selectUploadReferences, findAssetPicker, discoverAssetCards, identifyUploadedAssets, setCardSelected, selectUploadedAssets, findAddAssetsButton };
  Object.assign(bridge.uploader, { ingredientButton, ingredientReferences, sendIngredients, appliedImages });
  bridge.VibesUploadAdapter = bridge.uploader;
})();
