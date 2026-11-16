import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { studioClient } from './nyoni-store.js';

const execFileAsync = promisify(execFile);

async function download(url, target) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Cutline could not download media: HTTP ${response.status}.`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

export async function assembleDialogueCut(assignment, { video, dialogueMedia, durationSeconds = 10 }) {
  if (!ffmpegPath) throw new Error('Cutline FFmpeg binary is unavailable in this runtime.');
  if (!video?.url) throw new Error('Cutline requires a generated source video.');
  if (!dialogueMedia?.length) throw new Error('Cutline requires at least one exact dialogue master.');
  const dir = await mkdtemp(path.join(tmpdir(), 'nyoni-cutline-'));
  try {
    const videoPath = path.join(dir, 'source.mp4');
    const outputPath = path.join(dir, 'finished.mp4');
    await download(video.url, videoPath);
    const audioPaths = [];
    for (let index = 0; index < dialogueMedia.length; index += 1) {
      const audioPath = path.join(dir, `line-${index + 1}.mp3`);
      await download(dialogueMedia[index].url, audioPath);
      audioPaths.push(audioPath);
    }
    const inputs = ['-i', videoPath];
    audioPaths.forEach((item) => inputs.push('-i', item));
    const filters = dialogueMedia.map((item, index) => {
      const delay = Math.max(0, Math.round(Number(item.startSeconds || 0) * 1000));
      return `[${index + 1}:a]adelay=${delay}|${delay},volume=1.0[a${index + 1}]`;
    });
    const labels = dialogueMedia.map((_, index) => `[a${index + 1}]`).join('');
    filters.push(`${labels}amix=inputs=${dialogueMedia.length}:duration=longest:dropout_transition=0,atrim=0:${durationSeconds},apad=whole_dur=${durationSeconds}[dialogue]`);
    await execFileAsync(ffmpegPath, [
      '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[dialogue]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(durationSeconds), '-movflags', '+faststart', outputPath,
    ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    const { stderr = '' } = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', outputPath, '-f', 'null', '-'], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }).catch((error) => ({ stderr: error.stderr || '' }));
    const buffer = await readFile(outputPath);
    const client = studioClient();
    const storagePath = `${assignment.owner_id}/${assignment.id}/cutline-final.mp4`;
    const { error: uploadError } = await client.storage.from('nyoni-artifacts').upload(storagePath, buffer, { contentType: 'video/mp4', upsert: true });
    if (uploadError) throw new Error(`Cutline upload failed: ${uploadError.message}`);
    const url = client.storage.from('nyoni-artifacts').getPublicUrl(storagePath).data.publicUrl;
    const metadata = { assignmentId: assignment.id, role: 'cutline_final', durationSeconds, sourceAssetId: video.assetId, dialogueAssetIds: dialogueMedia.map((item) => item.assetId), probe: String(stderr).slice(-5000) };
    const { data: asset, error: assetError } = await client.from('assets').insert({ user_id: assignment.owner_id, project_id: assignment.project_id, type: 'video', url, storage_path: storagePath, provider: 'cutline', model: 'ffmpeg-static-5.3.0', prompt: assignment.title, metadata }).select('id').single();
    if (assetError) throw new Error(`Cutline asset record failed: ${assetError.message}`);
    const media = { url, assetId: asset.id, type: 'video', kind: 'dialogue-edit', provider: 'cutline', model: 'ffmpeg-static-5.3.0', playable: true, role: 'cutline_final', durationSeconds };
    const reviewFrames = [];
    for (const [index, second] of [1, Math.max(1, durationSeconds / 2), Math.max(1, durationSeconds - 1)].entries()) {
      const framePath = path.join(dir, `qa-${index + 1}.jpg`);
      await execFileAsync(ffmpegPath, ['-y', '-ss', String(second), '-i', outputPath, '-frames:v', '1', '-q:v', '2', framePath], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      const frameStoragePath = `${assignment.owner_id}/${assignment.id}/cutline-qa-${index + 1}.jpg`;
      const { error: frameUploadError } = await client.storage.from('nyoni-artifacts').upload(frameStoragePath, await readFile(framePath), { contentType: 'image/jpeg', upsert: true });
      if (frameUploadError) throw new Error(`Cutline QA frame upload failed: ${frameUploadError.message}`);
      reviewFrames.push({ second, url: client.storage.from('nyoni-artifacts').getPublicUrl(frameStoragePath).data.publicUrl });
    }
    const { error: runError } = await client.from('nyoni_tool_runs').upsert({ assignment_id: assignment.id, owner_id: assignment.owner_id, tool_name: 'dialogue-edit', provider: 'cutline', status: 'done', idempotency_key: `${assignment.id}:cutline:dialogue-v1`, input: { sourceAssetId: video.assetId, dialogueAssetIds: dialogueMedia.map((item) => item.assetId) }, output: { media: [media] }, cost_usd: 0, completed_at: new Date().toISOString() }, { onConflict: 'owner_id,idempotency_key' });
    if (runError) throw new Error(`Cutline tool run failed: ${runError.message}`);
    return { media: [media], reviewFrames, totalCostUsd: 0, provider: 'cutline', model: 'ffmpeg-static-5.3.0', probe: String(stderr).slice(-5000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
