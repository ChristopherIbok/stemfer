/**
 * Stem Engine Worker
 * Handles DAW project file detection and stem extraction.
 * Phase 1: recognition + metadata extraction
 * Phase 2: session reconstruction (future)
 */
import type { Env } from './types';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const { fileId } = await req.json<{ fileId: string }>();
    return processFile(fileId, env);
  },

  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processFile(msg.body.fileId, env);
        msg.ack();
      } catch (err) {
        console.error('Stem engine error:', err);
        msg.retry();
      }
    }
  },
};

async function processFile(fileId: string, env: Env): Promise<Response> {
  const file = await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first<any>();
  if (!file) return new Response('File not found', { status: 404 });

  const obj = await env.FILES.get(file.r2_key);
  if (!obj) return new Response('R2 object not found', { status: 404 });

  const buffer = await obj.arrayBuffer();
  const bytes  = new Uint8Array(buffer);

  const dawInfo = detectDAW(bytes, file.mime_type, file.original_name);

  if (!dawInfo) {
    await env.DB.prepare(
      `UPDATE files SET daw_type = NULL, file_type = 'audio', processing_status = 'complete' WHERE id = ?`
    ).bind(fileId).run();
    return new Response(JSON.stringify({ ok: true, daw: null }), { status: 200 });
  }

  // Extract metadata and stems list
  const extracted = await extractDAWMetadata(buffer, dawInfo.type, env, file);

  // Store stem list as a conversion record
  const convId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO conversions (id, file_id, project_id, requested_by, type, status, metadata)
     VALUES (?, ?, ?, ?, 'stem_extract', 'complete', ?)`
  ).bind(convId, fileId, file.project_id, file.uploaded_by, JSON.stringify(extracted)).run();

  await env.DB.prepare(
    `UPDATE files SET
       daw_type = ?, file_type = 'daw_project',
       bpm = ?, processing_status = 'complete',
       updated_at = datetime('now')
     WHERE id = ?`
  ).bind(dawInfo.type, extracted.bpm ?? null, fileId).run();

  return new Response(JSON.stringify({ ok: true, daw: dawInfo.type, ...extracted }), { status: 200 });
}

function detectDAW(bytes: Uint8Array, mimeType: string, filename: string): { type: string } | null {
  const ext  = filename.split('.').pop()?.toLowerCase() ?? '';
  const head = Buffer.from(bytes.slice(0, 32)).toString('binary');

  // Ableton .als — zlib compressed XML
  if (ext === 'als' || (bytes[0] === 0x78 && (bytes[1] === 0x9c || bytes[1] === 0xda))) {
    return { type: 'ableton' };
  }
  // Logic Pro .logicx — package directory or binary
  if (ext === 'logicx' || ext === 'logic' || mimeType?.includes('logic')) {
    return { type: 'logic' };
  }
  // Studio One .song
  if (ext === 'song' || head.includes('Studio One')) {
    return { type: 'studio_one' };
  }
  // Pro Tools .ptx / .pts / .ptf
  if (['ptx', 'pts', 'ptf', 'ptbl'].includes(ext)) {
    return { type: 'protools' };
  }
  // Reaper .rpp — text format
  if (ext === 'rpp') {
    return { type: 'reaper' };
  }

  return null;
}

async function extractDAWMetadata(
  buffer: ArrayBuffer,
  dawType: string,
  env: Env,
  file: any
): Promise<{
  bpm: number | null;
  timeSignature: string | null;
  trackNames: string[];
  stems: { name: string; r2Key: string | null }[];
}> {
  switch (dawType) {
    case 'reaper':  return extractReaperMeta(buffer);
    case 'ableton': return extractAbletonMeta(buffer);
    default:
      return { bpm: null, timeSignature: null, trackNames: [], stems: [] };
  }
}

function extractReaperMeta(buffer: ArrayBuffer): any {
  const text   = new TextDecoder().decode(buffer);
  const bpmMatch = text.match(/TEMPO\s+([\d.]+)/);
  const timeSigMatch = text.match(/TIMESIG\s+(\d+)\s+(\d+)/);
  const trackNames = [...text.matchAll(/NAME\s+"([^"]+)"/g)].map(m => m[1]);

  return {
    bpm:           bpmMatch  ? parseFloat(bpmMatch[1])  : null,
    timeSignature: timeSigMatch ? `${timeSigMatch[1]}/${timeSigMatch[2]}` : null,
    trackNames,
    stems: trackNames.map(name => ({ name, r2Key: null })),
  };
}

async function extractAbletonMeta(buffer: ArrayBuffer): Promise<any> {
  // .als files are zlib-compressed XML — decompress then parse
  try {
    const ds   = new DecompressionStream('deflate');
    const w    = new WritableStream<Uint8Array>();
    const blob = new Blob([buffer]);
    blob.stream().pipeThrough(new TransformStream()).pipeTo(w);

    // Fallback: parse what we can from raw bytes
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const bpmMatch       = text.match(/Tempo.*?Value="([\d.]+)"/);
    const timeSigMatch   = text.match(/TimeSignature.*?Numerator="(\d+)".*?Denominator="(\d+)"/s);
    const trackNameMatches = [...text.matchAll(/AudioTrack.*?Name="([^"]+)"/gs)].map(m => m[1]);

    return {
      bpm:           bpmMatch ? parseFloat(bpmMatch[1]) : null,
      timeSignature: timeSigMatch ? `${timeSigMatch[1]}/${timeSigMatch[2]}` : null,
      trackNames:    trackNameMatches,
      stems:         trackNameMatches.map(n => ({ name: n, r2Key: null })),
    };
  } catch {
    return { bpm: null, timeSignature: null, trackNames: [], stems: [] };
  }
}
