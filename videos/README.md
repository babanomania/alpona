# @alpona/videos

Regenerable demo videos. Playwright drives the studio against the
**deterministic mock agent** on a throwaway DuckDB, so the recording is
reproducible frame-for-frame (decision D14) — no API key, no network.

```bash
pnpm --filter @alpona/videos record         # mock-agent playground → .cache/test-results/**/video.webm
pnpm --filter @alpona/videos record:docker   # record against the running Docker stack (auth + live agent)
pnpm --filter @alpona/videos vo              # ElevenLabs voiceover from the recorded timing (needs a key)
pnpm --filter @alpona/videos assemble        # cover → recording (+VO) → end card → mp4 (ffmpeg)
```

## Voiceover (ElevenLabs)

The recording emits `.cache/timing.json` — every spoken caption with the exact
millisecond it appeared. `pnpm vo` synthesizes each line and lays it back at
that timestamp, so narration is frame-synced to the visuals. Then `assemble`
muxes `voiceover.mp3` over the video (offset past the cover).

```bash
export ELEVENLABS_API_KEY=sk_…
export ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # optional — defaults to "Rachel"
pnpm --filter @alpona/videos record:docker        # produces timing.json
pnpm --filter @alpona/videos vo                    # → .cache/vo/voiceover.mp3
pnpm --filter @alpona/videos assemble              # final mp4 now has narration
```

Edit narration by editing the captions in `tests/demo.spec.ts` (they are the
script); re-record to refresh `timing.json`.

- `tests/global-setup.ts` — seeds `.cache/demo.duckdb` from the supply-chain
  pack via the prompt-free workflow commands (no `.env`, no wizard).
- `playwright.config.ts` — boots the server (mock, port 3001) and studio
  (5173), records 1280×720.
- `src/overlay.ts` — animated fake cursor, click ripples, caption lower-thirds
  (headless Chromium never paints the OS pointer).
- `scripts/assemble.ts` — ffmpeg assembly (cover + end card) → `website/public/videos/`.

Generated artifacts live under `.cache/` and are git-ignored.
