# PromptDirector Bridge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable Developer mode.
3. Choose **Load unpacked** and select this `browser-extension` folder.
4. Open PromptDirector. The Bridge first attempts automatic discovery.
5. Sign in to Meta Vibes normally. The extension never requests or stores credentials or cookies.

If automatic discovery is unavailable, copy the extension ID from `chrome://extensions`, paste it in PromptDirector → Settings → Providers, click **SAVE**, then **TEST BRIDGE**. The ID is an optional, device-local fallback.

After updating the folder, click **Reload** on the extension card and reload the Vibes tab so its content scripts update. The extension validates the package, resolves the current shot references into an in-memory session store, and shows thumbnails, prompt, duration, aspect ratio, and diagnostics. Reloading the extension clears the in-memory session; send the current package again through the existing PromptDirector flow.

The bridge is split into `bridgeReceiver`, `vibesNavigator`, `vibesUploader`, `vibesPrompt`, and `vibesGenerator`. Upload and editor readiness use DOM observers with bounded timeouts; navigation uses browser load events and controlled retry.

The PromptDirector page normally communicates with its content script through a validated `window.postMessage` handshake. When an optional Extension ID is configured, it can instead use Chrome external messaging directly. Both paths accept commands only from the configured PromptDirector Site (plus local development) and validate every generation package.

## Verify Scene 04 / Shot 04.07 in Chrome

Use ASSISTED mode with the package's Vibes project open. Confirm the panel shows the correct shot, four resolved images, 5 sec and 16:9.

1. **INSERT PROMPT**: inspect the Vibes editor. It must contain only the shot prompt. Prompts above 9500 characters are rejected without truncation.
2. **APPLY SETTINGS**: confirm 5s and 16:9 in Vibes. Already correct controls are left untouched. Missing or unverifiable controls produce an error.
3. **SET INITIAL FRAME**: confirm the storyboard appears as the initial frame in the editor. Reference priority is previousFrame → explicit initialFrame → storyboard.
4. **SEND INGREDIENTS**: confirm Scaeva Official, Vitus Official and Vitus Hair are selected and their previews appear in the editor. Frame references are excluded from ingredients.
5. **GENERATE**: available after all four steps succeed. Confirm that a new generation enters the queue or starts progressing. The panel should show all five checks and **Generation ✓ Submitted**.

Each operation has its own result and error; failure stops AUTO and preserves other completed steps. The shared upload adapter reads only resolved session assets, creates nonempty image Files, and tries FILE_INPUT → DRAG_DROP → MAIN_WORLD. Assigning input.files is never sufficient for success. MAIN_WORLD targets only the marked input in the requesting frame.

After the assisted flow is validated, AUTO → **RUN AUTO** runs those same operations in order: ingredients, initial frame, prompt, settings, generate. Selecting AUTO alone does not submit anything. A successful submission cannot be repeated for the same package in the same loaded page. After a submission timeout, inspect Vibes before retrying: absence of detectable progress does not prove the click was rejected.

Diagnostics shows asset names, byte sizes, MIME types, detected controls, Vibes state, upload strategy, current step, last stage and last error. If a picker remains open after a failed step, close it in Vibes before trying another operation. Reloading Vibes resets its verified step flags; a new package also resets them. Closing/reopening only the panel retrieves the current page's flags.

## Local validation and remaining acceptance test

Run `node --test tests/bridge.test.cjs` with Node.js. Tests use simulated DOM controls and extension messages; they cover mapping, file validation, settings verification, generation evidence, prerequisites, prompt limits, state reset and AUTO sequencing. There is no configured linter or dependency installation requirement.

The live, authenticated Vibes flow has **not** been validated in this workspace. DOM labels/structure and preview URLs may vary. The adapter deliberately returns specific errors when selection or composer previews cannot be proven; the full acceptance criterion remains the five checks plus a real generation started for Shot 04.07. No PromptDirector app files or GenerationPackage schema were changed.
