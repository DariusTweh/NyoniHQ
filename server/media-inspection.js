import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { studioClient } from './nyoni-store.js';

const execFileAsync = promisify(execFile);

export async function inspectFinishedMedia(assignment, { video, durationSeconds = 10 }) {
  if (!ffmpegPath) throw new Error('Pulse media inspection needs the FFmpeg runtime.');
  if (!video?.url) throw new Error('Pulse needs the generated video for final media inspection.');
  const dir = await mkdtemp(path.join(tmpdir(), 'nyoni-pulse-'));
  try {
    const response = await fetch(video.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Pulse could not download generated media: HTTP ${response.status}.`);
    const videoPath = path.join(dir, 'generated.mp4');
    await writeFile(videoPath, Buffer.from(await response.arrayBuffer()));
    const { stderr = '' } = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', videoPath, '-f', 'null', '-'], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }).catch((error) => ({ stderr: error.stderr || '' }));
    const client = studioClient();
    const reviewFrames = [];
    for (const [index, second] of [1, Math.max(1, durationSeconds / 2), Math.max(1, durationSeconds - 1)].entries()) {
      const framePath = path.join(dir, `qa-${index + 1}.jpg`);
      await execFileAsync(ffmpegPath, ['-y', '-ss', String(second), '-i', videoPath, '-frames:v', '1', '-q:v', '2', framePath], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      const storagePath = `${assignment.owner_id}/${assignment.id}/pulse-qa-${index + 1}.jpg`;
      const { error } = await client.storage.from('nyoni-artifacts').upload(storagePath, await readFile(framePath), { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(`Pulse QA frame upload failed: ${error.message}`);
      reviewFrames.push({ second, url: client.storage.from('nyoni-artifacts').getPublicUrl(storagePath).data.publicUrl });
    }
    return { probe: String(stderr).slice(-5000), reviewFrames };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
