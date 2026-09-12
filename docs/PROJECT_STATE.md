# PromptDirector — Production State

## Current flow

`PREPARE SHOT → OPENAI ANALYSIS → META VIBES → REVIEW → APPROVE/REJECT → LAST FRAME → NEXT SHOT`

- Project Bible, production workspace, continuity engine and Project Assistant are preserved.
- `AIProvider` isolates OpenAI text, structured output, chat and image analysis. The configured model comes from `OPENAI_MODEL` (default requested: `gpt-5.6-luna`).
- Without `OPENAI_API_KEY`, continuity preparation and the Project Assistant fall back to the deterministic context engine; the UI reports OpenAI as not configured.
- `VideoGenerationProvider` isolates video services. `VibesProvider` supports `AUTO`, `BROWSER_BRIDGE`, `DIRECT_API` and `MANUAL` modes.
- The canonical Vibes project is `40c14372-cf55-4a4c-ba23-bdb454c9fb85`.
- Every generation creates a new immutable take plus a generation record. Polling updates progress and result state without overwriting older takes.
- Reference packaging uses only the continuity recommendations for the current shot: active character identity, previous approved last frame and current storyboard when applicable.
- Approved video uploads still extract the final frame automatically and connect it to the next shot.

## Runtime configuration

- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`.
- Vibes: the primary path is now the PromptDirector Bridge Chrome/Edge extension using the existing authenticated `vibes.ai` session. Server bridge variables remain an optional alternative.
- The extension accepts commands only from the configured PromptDirector origin and has host access only to `https://vibes.ai/*`.
- Provider Settings stores the device-local extension ID and reports Disconnected, Vibes not open, Authentication required or Ready.

## Persistence

- D1: project memory, shots, takes, assistant history, `generations` and `remote_assets`.
- R2: storyboards, official references, generated videos and approved last frames.
- Migration `0004_absurd_serpent_society.sql` is append-only.

## Verified

- 7 unit tests pass.
- TypeScript passes.
- Production build passes.

## Blocking configuration

- `OPENAI_API_KEY` and `gpt-5.6-luna` are configured. The key is valid, but its API account currently reports `credit_balance_exhausted`; deterministic analysis remains available until API credits are added.
- The first real Shot 04.07 test requires loading the extension into Chrome/Edge, pasting its generated ID into Providers, and signing in to Meta Vibes normally.
