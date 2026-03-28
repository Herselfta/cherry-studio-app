# Cross-Device Data Contract

This note defines the intended boundary between the app restore path for desktop `migration` packages and the shared `mobile sync` payload.

## Model Fields

- `assistant.model`
  - The assistant's currently active runtime model.
  - This is restored from `migration`.
  - This is also exported/imported through `mobile sync`.
- `assistant.defaultModel`
  - The assistant-local fallback/default model.
  - This is restored from `migration`.
  - This is also exported/imported through `mobile sync`.
- `llm.defaultModel` (desktop) / `llm.default_model` (app preference)
  - App-global default model used when an assistant has no explicit `model`.
  - This is restored from desktop `migration`.
  - This is intentionally separate from the default assistant's active model.
  - This is intentionally not part of `mobile sync`.

## Desktop `migration` -> App

- Purpose: portable restore.
- Behavior: clear-and-restore logical data on mobile.
- Model behavior:
  - Restore per-assistant `model` and `defaultModel`.
  - Restore desktop-global `llm.defaultModel` into app `llm.default_model`.
  - Never overwrite the default assistant's active `model` with the global default model.
- References:
  - `/Users/mac/GitHub/cherry-studio-app/src/services/BackupService.ts`
  - `/Users/mac/GitHub/cherry-studio-app/src/services/AssistantService.ts`

## App/Desktop `mobile sync`

- Purpose: merge shared data between devices.
- Behavior: upsert shared entities without wiping the target device.
- Model behavior:
  - Sync per-assistant `model` and `defaultModel`.
  - Does not sync app-global or desktop-global default model state.
  - Does not treat helper/system-only assistants such as `quick` and `translate` as normal cross-device assistants.
- References:
  - `/Users/mac/GitHub/cherry-studio-app/src/services/MobileSyncService.ts`
  - `/Users/mac/GitHub/cherry-studio-app/src/services/mobileSyncUtils.ts`
  - `/Users/mac/GitHub/cherry-studio/src/renderer/src/services/MobileSyncService.ts`
  - `/Users/mac/GitHub/cherry-studio/src/renderer/src/services/mobileSyncUtils.ts`

## Guardrails

- Do not map desktop `llm.defaultModel` onto the default assistant's active `model`.
- Do not drop `assistant.model` during `mobile sync` export/import.
- If assistant model semantics change, update both desktop and app tests together.
