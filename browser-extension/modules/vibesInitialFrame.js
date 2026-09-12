(() => {
  const bridge = globalThis.PromptDirectorBridge ||= {};
  const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0;
  const label = (element) => (element?.textContent || element?.getAttribute?.("aria-label") || "").trim();
  const error = (stage, errorCode, message, details = {}) => Object.assign(new Error(message), { stage, errorCode, details });

  function normalized(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function findPicker() {
    return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[data-radix-dialog-content]')]
      .filter(visible)
      .find((dialog) => /selecionar o fotograma inicial|fotograma inicial|initial frame/.test(normalized(label(dialog)))) || null;
  }

  function chooseReference(packageData) {
    const references = Array.isArray(packageData?.references) ? packageData.references : [];
    const descriptor = (reference) => normalized(`${reference.type || ""} ${reference.role || ""} ${reference.name || ""}`).replace(/[-\s]+/g, "_");
    const previous = references.find((reference) => /previous.*frame|last.*frame|frame.*previous/.test(descriptor(reference)));
    if (previous) return { reference: previous, source: "previous_frame", warning: null };
    const explicit = references.find((reference) => /initial.*frame|start.*frame/.test(descriptor(reference)));
    if (explicit) return { reference: explicit, source: "initial_frame", warning: null };
    const storyboard = references.find((reference) => /storyboard/.test(descriptor(reference)));
    if (storyboard) return { reference: storyboard, source: "storyboard", warning: "Previous frame unavailable; storyboard used as initial frame." };
    return { reference: null, source: null, warning: null };
  }

  function frameCards(picker) {
    const preview = findPreviewRegion(picker);
    return bridge.uploader.discoverAssetCards(picker).filter((card) => !preview?.contains(card.element));
  }

  function findPreviewRegion(picker) {
    const marker = [...picker.querySelectorAll("aside,section,div,p,span")]
      .filter(visible)
      .find((element) => /pre-visualizacao do fotograma inicial|initial frame preview/.test(normalized(label(element))) && element.children.length < 8);
    return marker?.closest('aside,[data-testid*="preview" i],[class*="preview" i],section,div') || null;
  }

  function previewSignature(region) {
    if (!region) return "";
    const images = [...region.querySelectorAll("img")].filter(visible).map((image) => image.currentSrc || image.src || "");
    const backgrounds = [...region.querySelectorAll('[style*="background-image"]')].filter(visible).map((element) => element.style.backgroundImage || "");
    return JSON.stringify({ images, backgrounds, text: normalized(label(region)) });
  }

  function previewHasImage(region) {
    if (!region) return false;
    return [...region.querySelectorAll("img")].some((image) => visible(image) && Boolean(image.currentSrc || image.src))
      || [...region.querySelectorAll('[style*="background-image"]')].some((element) => visible(element) && /url\(/.test(element.style.backgroundImage || ""));
  }

  function findUploadButton(picker) {
    return [...picker.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .find((element) => /^(carregar|upload|upload frame|carregar fotograma)\b/.test(normalized(label(element)))) || null;
  }

  function findAddToVideoButton(picker) {
    const candidates = [...picker.querySelectorAll('button,[role="button"]')].filter(visible);
    return candidates.find((element) => /ao video|to video|adicionar.*video|add.*video/.test(normalized(label(element)))) || null;
  }

  async function uploadFrame(picker, reference, report) {
    const before = frameCards(picker);
    const uploadButton = findUploadButton(picker);
    if (!uploadButton) throw error("INITIAL_FRAME_UPLOAD", "INITIAL_FRAME_UPLOAD_BUTTON_NOT_FOUND", "Meta Vibes initial-frame upload button was not found.", { emptyState: /sem resultados|no results/.test(normalized(label(picker))), assetsBefore: before.length });
    uploadButton.click();
    await report("INITIAL_FRAME_UPLOAD_STARTED", "uploading_references", { referenceId: reference.id, name: reference.name, assetsBefore: before.length });
    const uploadModal = await bridge.uploader.waitFor(() => bridge.uploader.findUploadModal(), { timeoutMs: 15000, stage: "REFERENCES_UPLOADING", errorCode: "FILE_INPUT_NOT_FOUND", message: "Meta Vibes image upload modal was not found.", details: { dialogsFound: bridge.uploader.visibleDialogs().length, referenceId: reference.id } });
    await bridge.uploader.uploadFilesInModal(uploadModal, [reference], report, { limit: 1 });

    const uploaded = await bridge.uploader.waitFor(() => {
      const currentPicker = findPicker();
      if (!currentPicker) return null;
      const cards = frameCards(currentPicker);
      const identified = bridge.uploader.identifyUploadedAssets(cards, before, [reference], true);
      return identified.cards.length === 1 ? { picker: currentPicker, cards, target: identified.cards[0], strategy: identified.strategy } : null;
    }, { timeoutMs: 30000, stage: "INITIAL_FRAME_UPLOAD", errorCode: "INITIAL_FRAME_UPLOAD_NOT_CONFIRMED", message: "The uploaded initial frame did not appear in Meta Vibes.", details: { referenceId: reference.id, assetsBefore: before.length } });
    await report("INITIAL_FRAME_UPLOADED", "uploading_references", { referenceId: reference.id, assetsBefore: before.length, assetsAfter: uploaded.cards.length, strategy: uploaded.strategy });
    return uploaded;
  }

  async function selectFrame(uploaded, report) {
    for (const card of uploaded.cards) {
      if (card.key !== uploaded.target.key && card.selected) await bridge.uploader.setCardSelected(card, false);
    }
    const previewRegion = findPreviewRegion(uploaded.picker);
    const beforePreview = previewSignature(previewRegion);
    const previewWasReady = Boolean(uploaded.target.selected && previewHasImage(previewRegion));
    if (!await bridge.uploader.setCardSelected(uploaded.target, true)) throw error("INITIAL_FRAME_SELECTION", "INITIAL_FRAME_SELECTION_FAILED", "Meta Vibes did not select the uploaded initial frame.", { assetId: uploaded.target.assetId, thumbnailSrc: uploaded.target.thumbnailSrc });
    const refreshed = frameCards(uploaded.picker);
    const selectedCount = refreshed.filter((card) => card.selected).length;
    if (selectedCount !== 1) throw error("INITIAL_FRAME_SELECTION", "INITIAL_FRAME_SELECTION_FAILED", "Meta Vibes did not keep exactly one initial frame selected.", { selectedFrameCount: selectedCount, expected: 1 });
    if (!previewWasReady) {
      await bridge.uploader.waitFor(() => {
        const region = findPreviewRegion(uploaded.picker);
        return region && previewHasImage(region) && previewSignature(region) !== beforePreview ? region : null;
      }, { timeoutMs: 10000, stage: "INITIAL_FRAME_SELECTION", errorCode: "INITIAL_FRAME_PREVIEW_NOT_UPDATED", message: "Meta Vibes initial-frame preview did not update.", details: { assetId: uploaded.target.assetId, selectedFrameCount: selectedCount } });
    }
    await report("INITIAL_FRAME_SELECTED", "uploading_references", { selectedFrameCount: 1, assetId: uploaded.target.assetId || null });
  }

  async function handle(picker, packageData, report) {
    if (!picker || !picker.isConnected || !visible(picker)) throw error("INITIAL_FRAME_PICKER", "INITIAL_FRAME_PICKER_NOT_FOUND", "Meta Vibes initial-frame picker was not found.", { dialogsFound: bridge.uploader.visibleDialogs().length });
    const selected = chooseReference(packageData);
    if (!selected.reference) throw error("INITIAL_FRAME_UPLOAD", "INITIAL_FRAME_ASSET_FETCH_FAILED", "No usable initial-frame reference exists in the generation package.", { referenceTypes: (packageData?.references || []).map((reference) => ({ type: reference.type, role: reference.role })) });
    await report("INITIAL_FRAME_PICKER_OPENED", "uploading_references", { source: selected.source, warning: selected.warning });
    const cards = frameCards(picker);
    const existing = bridge.uploader.identifyUploadedAssets(cards, [], [selected.reference], false);
    const uploaded = existing.cards.length === 1 ? { picker, cards, target: existing.cards[0] } : await uploadFrame(picker, selected.reference, report);
    await selectFrame(uploaded, report);
    const addButton = findAddToVideoButton(uploaded.picker);
    if (!addButton) throw error("INITIAL_FRAME_CONFIRMATION", "ADD_TO_VIDEO_BUTTON_NOT_FOUND", "Meta Vibes add-to-video button was not found.", { selectedFrameCount: 1 });
    if (addButton.disabled || addButton.getAttribute("aria-disabled") === "true") throw error("INITIAL_FRAME_CONFIRMATION", "ADD_TO_VIDEO_BUTTON_DISABLED", "Meta Vibes add-to-video button is disabled.", { selectedFrameCount: 1, label: label(addButton) });
    addButton.click();
    await report("INITIAL_FRAME_ADDED_TO_VIDEO", "uploading_references", { selectedFrameCount: 1, buttonLabel: label(addButton), source: selected.source });
    await bridge.uploader.waitFor(() => !uploaded.picker.isConnected || !visible(uploaded.picker), { timeoutMs: 30000, stage: "EDITOR_RETURNED", errorCode: "EDITOR_DID_NOT_RETURN", message: "Meta Vibes initial-frame picker did not close." });
    await bridge.uploader.waitFor(() => bridge.prompt?.findEditor?.() || null, { timeoutMs: 30000, stage: "EDITOR_RETURNED", errorCode: "EDITOR_DID_NOT_RETURN", message: "Meta Vibes editor did not return after adding the initial frame." });
    await report("EDITOR_RETURNED", "configuring", { initialFrameSource: selected.source });
    await bridge.uploader.waitFor(() => bridge.uploader.appliedImages([uploaded.target]), { timeoutMs: 15000, stage: "INITIAL_FRAME_SELECTION", errorCode: "INITIAL_FRAME_SELECTION_FAILED", message: "Initial-frame image not visible in the editor." });
    return [{ thumbnailSrc: uploaded.target.thumbnailSrc }];
  }

  function findControl() {
    return bridge.uploader.button(document, /fotograma inicial|initial.*frame|start.*frame/i);
  }

  async function setInitialFrame(context, report) {
    let code = "INITIAL_FRAME_BUTTON_NOT_FOUND";
    try {
      let picker = findPicker();
      if (!picker) {
        const control = findControl();
        if (!control) throw new Error("Initial/final frame control not found.");
        control.click();
        code = "INITIAL_FRAME_PICKER_NOT_FOUND";
        await bridge.uploader.waitFor(() => {
          picker = findPicker();
          if (picker) return picker;
          const start = bridge.uploader.button(document, /^(fotograma inicial|initial frame|start frame)$/i);
          if (start && start !== control) start.click();
          return null;
        }, { stage: "INITIAL_FRAME", errorCode: code, message: "Initial-frame picker did not open." });
      }
      code = "INITIAL_FRAME_UPLOAD_FAILED";
      return await handle(picker, context, report);
    } catch (cause) {
      if (/SELECTION|PREVIEW|CONFIRMATION|EDITOR_RETURNED/.test(cause.stage || "")) code = "INITIAL_FRAME_SELECTION_FAILED";
      throw error("INITIAL_FRAME", code, cause.message, { cause: cause.errorCode, ...cause.details });
    }
  }

  bridge.initialFrame = { findPicker, chooseReference, handle, findControl, setInitialFrame };
})();
