import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// scripts/ → videos/
const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const cache = resolve(pkg, '.cache');
const timingPath = resolve(cache, 'timing.json');
const voDir = resolve(cache, 'vo');
const clipsDir = resolve(voDir, 'clips');

const KEY = process.env.ELEVENLABS_API_KEY;
// Defaults to ElevenLabs' "Rachel" preset; override with any voice id.
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
const MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
// Faster, punchier delivery for the marketing cut. speed 0.7–1.2.
const SPEED = Number(process.env.ELEVENLABS_SPEED ?? '1.12');
const STABILITY = Number(process.env.ELEVENLABS_STABILITY ?? '0.32');
const STYLE = Number(process.env.ELEVENLABS_STYLE ?? '0.55');
const scriptPath = resolve(pkg, 'voiceover', 'script.json');

interface Timing {
  durationMs: number;
  lines: { text: string; at: number }[];
}

async function synth(text: string, outMp3: string): Promise<void> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': KEY as string,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: {
          stability: STABILITY,
          similarity_boost: 0.8,
          style: STYLE,
          use_speaker_boost: true,
          speed: SPEED,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  writeFileSync(outMp3, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  if (!KEY) {
    console.error('✗ ELEVENLABS_API_KEY is required (and optionally ELEVENLABS_VOICE_ID).');
    process.exit(1);
  }
  if (!existsSync(timingPath)) {
    console.error('✗ no .cache/timing.json — run `pnpm record:docker` first.');
    process.exit(1);
  }
  const timing = JSON.parse(readFileSync(timingPath, 'utf8')) as Timing;
  mkdirSync(clipsDir, { recursive: true });

  // Marketing override: voiceover/script.json maps each on-screen caption to a
  // spoken line. Matching by caption (loosely normalized) keeps the VO aligned
  // even when the live agent skips a beat — index position is never assumed.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[—–]/g, '-')
      .replace(/…/g, '...')
      .replace(/\s+/g, ' ')
      .trim();
  let override: Map<string, string> | null = null;
  if (existsSync(scriptPath)) {
    const parsed = JSON.parse(readFileSync(scriptPath, 'utf8')) as { map?: Record<string, string> };
    if (parsed.map) override = new Map(Object.entries(parsed.map).map(([k, v]) => [norm(k), v]));
  }
  console.log(`  voice ${VOICE} · speed ${SPEED} · ${override ? 'marketing script' : 'captions'}`);

  const clips: { mp3: string; at: number }[] = [];
  for (let i = 0; i < timing.lines.length; i++) {
    const line = timing.lines[i]!;
    const text = override?.get(norm(line.text)) ?? line.text;
    if (override && !override.has(norm(line.text))) {
      console.warn(`  ⚠ no marketing line for caption: "${line.text}"`);
    }
    if (!text) continue;
    const mp3 = resolve(clipsDir, `line_${String(i).padStart(2, '0')}.mp3`);
    process.stdout.write(`  ▸ [${i + 1}/${timing.lines.length}] ${text.slice(0, 52)}\n`);
    await synth(text, mp3);
    clips.push({ mp3, at: line.at });
  }

  // Lay each clip at its recorded timestamp over a silent base the length of
  // the recording, then mix down to a single track.
  const durSec = (timing.durationMs / 1000).toFixed(3);
  const inputs: string[] = ['-f', 'lavfi', '-t', durSec, '-i', 'anullsrc=r=44100:cl=stereo'];
  for (const c of clips) inputs.push('-i', c.mp3);
  const filters = clips.map(
    (c, i) =>
      `[${i + 1}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${c.at}|${c.at}[a${i}]`,
  );
  const mixLabels = clips.map((_, i) => `[a${i}]`).join('');
  const graph =
    `${filters.join(';')};[0:a]${mixLabels}` +
    `amix=inputs=${clips.length + 1}:normalize=0:dropout_transition=0[out]`;
  const outMp3 = resolve(voDir, 'voiceover.mp3');
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-t', durSec, outMp3],
    { stdio: 'inherit' },
  );
  console.log(`✓ voiceover (${clips.length} lines) → ${outMp3}`);
  console.log('  now run `pnpm assemble` to mux it into the final video.');
}

void main();
