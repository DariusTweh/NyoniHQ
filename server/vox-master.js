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
  if (!response.ok) throw new Error(`Vox could not download dialogue media: HTTP ${response.status}.`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

export async function assembleDialogueReferenceMaster(assignment, { dialogueMedia, durationSeconds = 10, dialogueSignature }) {
  if (!ffmpegPath) throw new Error('Vox reference-master assembly needs the FFmpeg runtime.');
  if (!dialogueMedia?.length) throw new Error('Vox reference-master assembly needs dialogue line media.');
  const dir = await mkdtemp(path.join(tmpdir(), 'nyoni-vox-master-'));
  try {
    const audioPaths = [];
    for (let index = 0; index < dialogueMedia.length; index += 1) {
      const audioPath = path.join(dir, `line-${index + 1}.mp3`);
      await download(dialogueMedia[index].url, audioPath);
      audioPaths.push(audioPath);
    }
    const outputPath = path.join(dir, 'dialogue-reference-master.mp3');
    const inputs = audioPaths.flatMap((item) => ['-i', item]);
    const filters = dialogueMedia.map((item, index) => {
      const delay = Math.max(0, Math.round(Number(item.startSeconds || 0) * 1000));
      return `[${index}:a]adelay=${delay}|${delay}[a${index}]`;
    });
    const labels = dialogueMedia.map((_, index) => `[a${index}]`).join('');
    filters.push(`${labels}amix=inputs=${dialogueMedia.length}:duration=longest:dropout_transition=0,apad=whole_dur=${durationSeconds},atrim=0:${durationSeconds}[master]`);
    await execFileAsync(ffmpegPath, ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[master]', '-c:a', 'libmp3lame', '-b:a', '192k', '-t', String(durationSeconds), outputPath], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const client = studioClient();
    const storagePath = `${assignment.owner_id}/${assignment.id}/vox-dialogue-reference-master.mp3`;
    const { error: uploadError } = await client.storage.from('nyoni-artifacts').upload(storagePath, await readFile(outputPath), { contentType: 'audio/mpeg', upsert: true });
    if (uploadError) throw new Error(`Vox reference-master upload failed: ${uploadError.message}`);
    const url = client.storage.from('nyoni-artifacts').getPublicUrl(storagePath).data.publicUrl;
    const metadata = { assignmentId: assignment.id, role: 'dialogue_reference_master', dialogueSignature, durationSeconds, sourceAssetIds: dialogueMedia.map((item) => item.assetId), preservation: 'exact_generation_reference' };
    const { data: asset, error: assetError } = await client.from('assets').insert({ user_id: assignment.owner_id, project_id: assignment.project_id, type: 'audio', url, storage_path: storagePath, provider: 'vox', model: 'ffmpeg-static-5.3.0', prompt: assignment.title, metadata }).select('id').single();
    if (assetError) throw new Error(`Vox reference-master asset failed: ${assetError.message}`);
    return { media: [{ url, assetId: asset.id, type: 'audio', kind: 'dialogue-reference-master', provider: 'vox', model: 'ffmpeg-static-5.3.0', playable: true, role: 'dialogue_reference_master', startSeconds: 0, endSeconds: durationSeconds, durationSeconds, dialogueSignature }] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
