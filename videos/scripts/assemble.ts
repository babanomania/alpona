import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// scripts/ → videos/ → repo root.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const root = resolve(pkg, '..');
const out = resolve(pkg, '.cache/out');
const dest = resolve(root, 'website/public/videos');

const main =
  process.env.ALPONA_MAIN ??
  resolve(pkg, '.cache/docker-results/demo-alpona-product-walkthrough/video.webm');
const vo = resolve(pkg, '.cache/vo/voiceover.mp3'); // optional, from `pnpm vo`

const FPS = 30;
const COVER = 3.2;
const END = 4.2;

function ff(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: 'inherit',
  });
}
function duration(file: string): number {
  const s = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nk=1:nw=1',
    file,
  ]);
  return parseFloat(s.toString().trim());
}

/** Render an HTML card to a crisp 1280×720 still (optional query string). */
async function shoot(htmlRel: string, png: string, query = ''): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  await page.goto(pathToFileURL(resolve(pkg, htmlRel)).href + query);
  await page.waitForTimeout(1400); // let fonts + image settle
  await page.screenshot({ path: png });
  await browser.close();
}

async function main_() {
  if (!existsSync(main)) throw new Error(`recording not found: ${main} (run pnpm record:docker)`);
  mkdirSync(out, { recursive: true });
  mkdirSync(dest, { recursive: true });

  const coverPng = resolve(out, 'cover.png');
  const endPng = resolve(out, 'endcard.png');
  // Layer the captured website particle field behind the cover, when present.
  const bgPng = resolve(out, 'cover-bg.png');
  const coverQuery = existsSync(bgPng) ? `?bg=${pathToFileURL(bgPng).href}` : '';
  await shoot('assets/cover.html', coverPng, coverQuery);
  await shoot('assets/endcard.html', endPng);

  const segCover = resolve(out, 'seg_cover.mp4');
  const segMain = resolve(out, 'seg_main.mp4');
  const segEnd = resolve(out, 'seg_end.mp4');

  // Cover & end card: a still held with clean fades.
  ff([
    '-loop',
    '1',
    '-t',
    String(COVER),
    '-i',
    coverPng,
    '-vf',
    `scale=1280:720,fade=t=in:st=0:d=0.5,fade=t=out:st=${(COVER - 0.5).toFixed(2)}:d=0.5,format=yuv420p`,
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    segCover,
  ]);
  ff([
    '-loop',
    '1',
    '-t',
    String(END),
    '-i',
    endPng,
    '-vf',
    `scale=1280:720,fade=t=in:st=0:d=0.6,fade=t=out:st=${(END - 0.7).toFixed(2)}:d=0.7,format=yuv420p`,
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    segEnd,
  ]);

  // Recording: normalize + gentle fades, drop any audio.
  const mdur = duration(main);
  ff([
    '-i',
    main,
    '-vf',
    `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=${FPS},fade=t=in:st=0:d=0.5,fade=t=out:st=${(mdur - 0.5).toFixed(2)}:d=0.5,format=yuv420p`,
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    segMain,
  ]);

  // Concatenate the three identically-encoded segments.
  const listFile = resolve(out, 'concat.txt');
  writeFileSync(listFile, [segCover, segMain, segEnd].map((f) => `file '${f}'`).join('\n'));
  const silent = resolve(out, 'assembled-silent.mp4');
  ff([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    silent,
  ]);

  const finalMp4 = resolve(dest, 'alpona-walkthrough.mp4');
  if (existsSync(vo)) {
    // Mux the ElevenLabs voiceover over the video, offset so narration
    // starts after the cover. Audio is the shorter of the two streams.
    ff([
      '-i',
      silent,
      '-itsoffset',
      String(COVER),
      '-i',
      vo,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      finalMp4,
    ]);
    console.log('✓ assembled with voiceover →', finalMp4);
  } else {
    execFileSync('cp', [silent, finalMp4]);
    console.log('✓ assembled (silent — run `pnpm vo` for narration) →', finalMp4);
  }

  // Poster frame for the website embed.
  execFileSync('cp', [coverPng, resolve(dest, 'alpona-walkthrough-poster.png')]);
  console.log('  poster →', resolve(dest, 'alpona-walkthrough-poster.png'));
}

void main_();
