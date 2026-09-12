export const GENERATION_PACKAGE_SCHEMA_VERSION = 1;
const ALLOWED_ASSET_ORIGINS = new Set(["https://property-director-studio.iagomaneiraso.chatgpt.site", "http://localhost:3000", "http://127.0.0.1:3000"]);

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && Boolean(value.trim());
const add = (bucket, path, code, message) => bucket.push({ path, code, message });

export function isAllowedAssetUrl(assetUrl) {
  if (!isText(assetUrl)) return false;
  if (assetUrl.startsWith("data:image/")) return true;
  try { const url = new URL(assetUrl); return ALLOWED_ASSET_ORIGINS.has(url.origin) && url.pathname === "/api/assets"; }
  catch { return false; }
}

export function validateGenerationPackage(value) {
  const errors = { missing: [], invalid: [], unresolvedAssets: [] };
  if (!isObject(value)) {
    add(errors.invalid, "$", "INVALID_PACKAGE", "Generation package must be an object.");
    return { success: false, errors };
  }
  if (value.schemaVersion == null) add(errors.missing, "schemaVersion", "MISSING_SCHEMA_VERSION", "schemaVersion is required.");
  else if (value.schemaVersion !== GENERATION_PACKAGE_SCHEMA_VERSION) add(errors.invalid, "schemaVersion", "UNSUPPORTED_SCHEMA_VERSION", "schemaVersion must be 1.");
  if (!isText(value.requestId)) add(errors.missing, "requestId", "MISSING_REQUEST_ID", "requestId is required.");

  if (!isObject(value.project)) add(errors.missing, "project", "MISSING_PROJECT", "project is required.");
  else {
    if (!isText(value.project.id)) add(errors.missing, "project.id", "MISSING_PROJECT_ID", "project.id is required.");
    if (value.project.videoProvider !== "vibes") add(errors.invalid, "project.videoProvider", "INVALID_VIDEO_PROVIDER", "videoProvider must be vibes.");
    if (!isText(value.project.vibesProjectUrl)) add(errors.missing, "project.vibesProjectUrl", "MISSING_PROJECT_URL", "vibesProjectUrl is required.");
    else try { const url = new URL(value.project.vibesProjectUrl); if (url.protocol !== "https:" || url.hostname !== "vibes.ai" || !url.pathname.startsWith("/projects/")) add(errors.invalid, "project.vibesProjectUrl", "INVALID_PROJECT_URL", "vibesProjectUrl must be a Vibes project URL."); } catch { add(errors.invalid, "project.vibesProjectUrl", "INVALID_PROJECT_URL", "vibesProjectUrl must be a valid URL."); }
  }

  if (!isObject(value.shot)) add(errors.missing, "shot", "MISSING_SHOT", "shot is required.");
  else for (const field of ["sceneId","shotId","title"]) if (!isText(value.shot[field])) add(errors.missing, `shot.${field}`, `MISSING_${field.replace(/([A-Z])/g,"_$1").toUpperCase()}`, `shot.${field} is required.`);

  if (!isObject(value.generation)) add(errors.missing, "generation", "MISSING_GENERATION", "generation is required.");
  else {
    if (!isText(value.generation.prompt)) add(errors.missing, "generation.prompt", "MISSING_PROMPT", "prompt is required.");
    if (value.generation.durationSeconds == null) add(errors.missing, "generation.durationSeconds", "MISSING_DURATION", "durationSeconds is required.");
    else if (!Number.isInteger(value.generation.durationSeconds) || value.generation.durationSeconds < 1 || value.generation.durationSeconds > 60) add(errors.invalid, "generation.durationSeconds", "INVALID_DURATION", "durationSeconds must be an integer from 1 to 60.");
    if (!isText(value.generation.aspectRatio)) add(errors.missing, "generation.aspectRatio", "MISSING_ASPECT_RATIO", "aspectRatio is required.");
    else if (!/^\d{1,2}:\d{1,2}$/.test(value.generation.aspectRatio)) add(errors.invalid, "generation.aspectRatio", "INVALID_ASPECT_RATIO", "aspectRatio must use W:H format.");
  }

  if (!Array.isArray(value.references)) add(errors.missing, "references", "MISSING_REFERENCES", "references is required.");
  else if (value.references.length > 24) add(errors.invalid, "references", "TOO_MANY_REFERENCES", "At most 24 references are allowed.");
  else value.references.forEach((reference, index) => {
    const path = `references.${index}`;
    if (!isObject(reference)) { add(errors.invalid, path, "INVALID_REFERENCE", "Reference must be an object."); return; }
    for (const field of ["id","name","type","role","assetUrl","mimeType"]) if (!isText(reference[field])) add(errors.missing, `${path}.${field}`, `MISSING_REFERENCE_${field.replace(/([A-Z])/g,"_$1").toUpperCase()}`, `${field} is required.`);
    if (isText(reference.mimeType) && !reference.mimeType.startsWith("image/")) add(errors.invalid, `${path}.mimeType`, "INVALID_REFERENCE_MIME", "Reference must be an image.");
    if (isText(reference.assetUrl)) {
      if (reference.assetUrl.startsWith("blob:")) add(errors.unresolvedAssets, `${path}.assetUrl`, "BLOB_URL_NOT_ALLOWED", `${reference.name || "Reference"} could not be resolved.`);
      else if (reference.assetUrl.startsWith("data:")) {
        if (!reference.assetUrl.startsWith(`data:${reference.mimeType};base64,`)) add(errors.unresolvedAssets, `${path}.assetUrl`, "MIME_DATA_MISMATCH", `${reference.name || "Reference"} could not be resolved.`);
      } else if (!isAllowedAssetUrl(reference.assetUrl)) add(errors.unresolvedAssets, `${path}.assetUrl`, "UNRESOLVED_ASSET_URL", `${reference.name || "Reference"} could not be resolved.`);
    }
  });
  if (Array.isArray(value.references) && value.references.reduce((size,reference)=>size+(typeof reference?.assetUrl==="string"?reference.assetUrl.length:0),0)>60_000_000) add(errors.invalid,"references","REFERENCE_PAYLOAD_TOO_LARGE","Reference payload must not exceed 60 MB.");
  return { success: !errors.missing.length && !errors.invalid.length && !errors.unresolvedAssets.length, errors, data: value };
}

export function firstGenerationPackageError(result) {
  return result.errors.missing[0] || result.errors.invalid[0] || result.errors.unresolvedAssets[0] || null;
}

export function validateBridgeCommand(message) {
  if (!message || message.version !== GENERATION_PACKAGE_SCHEMA_VERSION || message.type !== "PD_START_GENERATION") return { accepted: false, stage: "PACKAGE_VALIDATION", errorCode: "INVALID_COMMAND", message: "Generation command is invalid.", details: null };
  const validation = validateGenerationPackage(message.generationPackage);
  if (!validation.success) { const first = firstGenerationPackageError(validation); return { accepted: false, stage: "PACKAGE_VALIDATION", errorCode: first?.code || "INVALID_GENERATION_PACKAGE", message: "Generation package invalid", details: validation.errors }; }
  return { accepted: true, stage: "PACKAGE_VALID", package: validation.data };
}
