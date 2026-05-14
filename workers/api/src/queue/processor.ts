import type { Env } from '../types/env';

export async function handleQueue(batch: MessageBatch<any>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processMessage(message.body, env);
      message.ack();
    } catch (err) {
      console.error('Queue processing error:', err);
      message.retry();
    }
  }
}

async function processMessage(body: any, env: Env): Promise<void> {
  switch (body.type) {
    case 'process_file':   return processFile(body.fileId, env);
    case 'delete_file':    return deleteFile(body.r2Key, body.fileId, env);
    case 'stem_extract':   return stemExtract(body.fileId, body.conversionId, env);
    case 'transfer_send':
      console.warn('[queue] transfer_send is no longer handled via queue — transfers are now processed synchronously');
      break;
    default:
      console.warn('Unknown queue message type:', body.type);
  }
}

async function processFile(fileId: string, env: Env): Promise<void> {
  const file = await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first<any>();
  if (!file) return;

  await env.DB.prepare(
    `UPDATE files SET processing_status = 'processing' WHERE id = ?`
  ).bind(fileId).run();

  try {
    const obj = await env.FILES.get(file.r2_key);
    if (!obj) throw new Error('R2 object not found');

    const buffer = await obj.arrayBuffer();
    const result = await analyzeAudioBuffer(buffer, file.mime_type);

    await env.DB.prepare(
      `UPDATE files SET
         duration_ms = ?, sample_rate = ?, bit_depth = ?, channels = ?,
         bpm = ?, leading_silence_ms = ?, first_transient_ms = ?,
         waveform_data = ?, bwf_timecode = ?,
         file_type = ?, daw_type = ?,
         processing_status = 'complete',
         analyzed = 1,
         updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      result.duration_ms, result.sample_rate, result.bit_depth, result.channels,
      result.bpm, result.leading_silence_ms, result.first_transient_ms,
      JSON.stringify(result.waveform_data), result.bwf_timecode,
      result.file_type, result.daw_type,
      fileId
    ).run();

    if (result.file_type === 'daw_project') {
      await env.PROCESSING_QUEUE.send({ type: 'stem_extract', fileId });
    }
  } catch (err: any) {
    await env.DB.prepare(
      `UPDATE files SET processing_status = 'failed', processing_error = ? WHERE id = ?`
    ).bind(err.message, fileId).run();
    throw err;
  }
}

async function deleteFile(r2Key: string, fileId: string, env: Env): Promise<void> {
  await env.FILES.delete(r2Key);
  await env.DB.prepare(`DELETE FROM files WHERE id = ?`).bind(fileId).run();
}

async function stemExtract(fileId: string, conversionId: string, env: Env): Promise<void> {
  // Stem extraction is handled by the stem-engine worker
  // This queues it there
  await env.DB.prepare(
    `UPDATE conversions SET status = 'processing', started_at = datetime('now') WHERE id = ?`
  ).bind(conversionId).run();
}

// Audio analysis — runs in Worker environment (no Node.js APIs)
async function analyzeAudioBuffer(buffer: ArrayBuffer, mimeType: string): Promise<{
  duration_ms: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  bpm: number | null;
  leading_silence_ms: number | null;
  first_transient_ms: number | null;
  waveform_data: number[];
  bwf_timecode: string | null;
  file_type: string;
  daw_type: string | null;
}> {
  const bytes = new Uint8Array(buffer);
  const isWAV = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;

  let duration_ms = null, sample_rate = null, bit_depth = null, channels = null;
  let bwf_timecode = null;
  let file_type    = 'audio';
  let daw_type: string | null = null;

  if (isWAV) {
    const view = new DataView(buffer);
    // fmt chunk: offset 12 in standard RIFF/WAVE
    channels    = view.getUint16(22, true);
    sample_rate = view.getUint32(24, true);
    bit_depth   = view.getUint16(34, true);

    // Find data chunk to compute duration
    let offset = 12;
    while (offset < bytes.length - 8) {
      const chunkId   = String.fromCharCode(...bytes.slice(offset, offset + 4));
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'data') {
        const byteRate  = view.getUint32(28, true);
        if (byteRate > 0) duration_ms = Math.floor((chunkSize / byteRate) * 1000);
        break;
      }

      // Parse BWF bext chunk for timecode
      if (chunkId === 'bext' && chunkSize >= 256) {
        bwf_timecode = parseBextTimecode(bytes, offset + 8, sample_rate ?? 48000);
      }

      offset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) offset++; // RIFF padding
    }
  } else {
    // Check for DAW project signatures
    const header = String.fromCharCode(...bytes.slice(0, 16));
    if (header.includes('BINA') || mimeType?.includes('logic'))      { file_type = 'daw_project'; daw_type = 'logic'; }
    else if (header.includes('Song') || mimeType?.includes('song'))   { file_type = 'daw_project'; daw_type = 'studio_one'; }
    else if (bytes[0] === 0x78 && bytes[1] === 0x9c)                  { file_type = 'daw_project'; daw_type = 'ableton'; } // zlib for .als
  }

  // Generate downsampled waveform peaks
  const waveform_data = generateWaveformPeaks(bytes, isWAV, 200);

  // Silence + transient detection
  const { leading_silence_ms, first_transient_ms } = detectSilenceAndTransients(
    bytes, isWAV, sample_rate, bit_depth, channels, duration_ms
  );

  return {
    duration_ms, sample_rate, bit_depth, channels,
    bpm: null, // BPM detection requires more complex DSP
    leading_silence_ms, first_transient_ms,
    waveform_data,
    bwf_timecode,
    file_type,
    daw_type,
  };
}

function parseBextTimecode(bytes: Uint8Array, offset: number, sampleRate: number): string | null {
  try {
    const view    = new DataView(bytes.buffer);
    // TimeReference is at offset 256 from start of bext chunk data (bytes 256-263)
    const timeRef = Number(view.getBigUint64(offset + 256, true));
    const totalMs = Math.floor((timeRef / sampleRate) * 1000);

    const h   = Math.floor(totalMs / 3600000);
    const m   = Math.floor((totalMs % 3600000) / 60000);
    const s   = Math.floor((totalMs % 60000) / 1000);
    const ms  = totalMs % 1000;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(ms).padStart(3,'0')}`;
  } catch {
    return null;
  }
}

function generateWaveformPeaks(bytes: Uint8Array, isWAV: boolean, numPeaks: number): number[] {
  const dataStart = isWAV ? findWAVDataOffset(bytes) : 0;
  const dataLen   = bytes.length - dataStart;
  if (dataLen <= 0 || dataStart < 0) return new Array(numPeaks).fill(0);

  const blockSize = Math.max(1, Math.floor(dataLen / numPeaks));
  const peaks: number[] = [];

  for (let i = 0; i < numPeaks; i++) {
    let max = 0;
    const start = dataStart + i * blockSize;
    const end   = Math.min(start + blockSize, bytes.length);
    for (let j = start; j < end; j += 2) {
      const sample = (bytes[j] | (bytes[j + 1] << 8)) - 32768;
      const abs    = Math.abs(sample) / 32768;
      if (abs > max) max = abs;
    }
    peaks.push(Math.round(max * 1000) / 1000);
  }
  return peaks;
}

function findWAVDataOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer);
  let offset = 12;
  while (offset < bytes.length - 8) {
    const chunkId   = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'data') return offset + 8;
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return -1;
}

function detectSilenceAndTransients(
  bytes: Uint8Array,
  isWAV: boolean,
  sampleRate: number | null,
  bitDepth: number | null,
  channels: number | null,
  durationMs: number | null
): { leading_silence_ms: number | null; first_transient_ms: number | null } {
  if (!isWAV || !sampleRate || !bitDepth || !channels || !durationMs) {
    return { leading_silence_ms: null, first_transient_ms: null };
  }

  const dataOffset    = findWAVDataOffset(bytes);
  if (dataOffset < 0) return { leading_silence_ms: null, first_transient_ms: null };

  const bytesPerSample = bitDepth / 8;
  const frameSize      = bytesPerSample * channels;
  const silenceThresh  = 0.005;
  const transientThresh = 0.15;

  let leading_silence_ms: number | null = null;
  let first_transient_ms: number | null = null;
  let pastSilence = false;
  let prevAmplitude = 0;

  const view    = new DataView(bytes.buffer);
  const maxFrames = Math.min(Math.floor((bytes.length - dataOffset) / frameSize), sampleRate * 10); // check first 10s

  for (let frame = 0; frame < maxFrames; frame++) {
    const bytePos = dataOffset + frame * frameSize;
    let amplitude = 0;
    for (let ch = 0; ch < channels; ch++) {
      const pos = bytePos + ch * bytesPerSample;
      const sample = bytesPerSample === 2
        ? (view.getInt16(pos, true)) / 32768
        : (bytes[pos] - 128) / 128;
      amplitude = Math.max(amplitude, Math.abs(sample));
    }

    const ms = Math.floor((frame / sampleRate) * 1000);

    if (!pastSilence && amplitude > silenceThresh) {
      leading_silence_ms = ms;
      pastSilence = true;
    }

    if (pastSilence && first_transient_ms === null && (amplitude - prevAmplitude) > transientThresh) {
      first_transient_ms = ms;
    }

    if (leading_silence_ms !== null && first_transient_ms !== null) break;
    prevAmplitude = amplitude;
  }

  return { leading_silence_ms, first_transient_ms };
}
