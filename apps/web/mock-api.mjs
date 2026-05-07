/**
 * Stemfer local mock API — port 8788
 * Simulates the Cloudflare Worker API so all pages render with real data.
 */
import http from 'http';
import crypto from 'crypto';

// ── In-memory store ─────────────────────────────────────────────────────────
const users = new Map();
const tokens = new Map();           // token → userId
const projects = new Map();
const files = new Map();
const sessions = new Map();
const activity = [];

// Seed demo data
const DEMO_USER_ID  = 'demo-user-001';
const DEMO_TOKEN    = 'demo-token-local';
const DEMO_PROJECT  = 'proj-001';
const DEMO_PROJECT2 = 'proj-002';
const DEMO_SESSION  = 'sess-001';
const DEMO_FILE1    = 'file-001';
const DEMO_FILE2    = 'file-002';

users.set(DEMO_USER_ID, {
  id: DEMO_USER_ID, email: 'demo@stemfer.com', name: 'Demo Producer',
  role: 'user', plan: 'pro', avatar_url: null,
  storage_used: 2_400_000_000, storage_limit_bytes: 107_374_182_400,
  upload_limit_bytes: 5_368_709_120, max_projects: 50,
  created_at: '2025-01-01T00:00:00Z',
});
tokens.set(DEMO_TOKEN, DEMO_USER_ID);

projects.set(DEMO_PROJECT, {
  id: DEMO_PROJECT, owner_id: DEMO_USER_ID, team_id: null,
  name: 'Album Session — March 2025', description: 'Main album tracking session with stems and mix files.',
  color: '#22c55e', bpm: 96, time_sig: '4/4', sample_rate: 48000,
  status: 'active', member_role: 'owner', file_count: 4, session_count: 2,
  is_public: 0, created_at: '2025-03-01T10:00:00Z', updated_at: '2025-04-15T18:32:00Z',
});
projects.set(DEMO_PROJECT2, {
  id: DEMO_PROJECT2, owner_id: DEMO_USER_ID, team_id: null,
  name: 'Beat Pack Vol.3', description: 'Trap & drill instrumentals for licensing.',
  color: '#a855f7', bpm: 140, time_sig: '4/4', sample_rate: 44100,
  status: 'active', member_role: 'owner', file_count: 12, session_count: 1,
  is_public: 0, created_at: '2025-02-10T09:00:00Z', updated_at: '2025-05-01T11:00:00Z',
});

sessions.set(DEMO_SESSION, {
  id: DEMO_SESSION, project_id: DEMO_PROJECT, name: 'Tracking — Day 1',
  description: 'Bass, drums, and guide vocals', bpm: 96, time_sig: '4/4',
  sample_rate: 48000, status: 'active', file_count: 3,
  created_at: '2025-03-01T10:00:00Z', updated_at: '2025-03-02T18:00:00Z',
});

const waveform = Array.from({ length: 200 }, () => Math.random() * 0.8 + 0.1);

files.set(DEMO_FILE1, {
  id: DEMO_FILE1, project_id: DEMO_PROJECT, session_id: DEMO_SESSION,
  uploaded_by: DEMO_USER_ID, uploader_name: 'Demo Producer',
  r2_key: `projects/${DEMO_PROJECT}/${DEMO_FILE1}/kick_stem.wav`,
  file_url: 'https://example.com/kick_stem.wav',
  filename: 'kick_stem.wav', original_name: 'Kick Stem (48kHz).wav',
  mime_type: 'audio/wav', size_bytes: 48_000_000,
  file_type: 'audio', daw_type: null,
  duration_ms: 240000, sample_rate: 48000, bit_depth: 24, channels: 2,
  bpm: 96, time_signature: '4/4',
  start_timecode: '00:00:00:000', offset_ms: 0, timeline_track: 0,
  is_locked: 0, is_muted: 0, group_id: null,
  analyzed: 1, leading_silence_ms: 0, first_transient_ms: 12,
  waveform_data: waveform,
  bwf_timecode: '00:00:00:000',
  version: 1, parent_file_id: null,
  download_count: 3, download_limit: null, expires_at: null,
  processing_status: 'complete', processing_error: null,
  created_at: '2025-03-01T12:00:00Z', updated_at: '2025-03-01T12:01:00Z',
});
files.set(DEMO_FILE2, {
  id: DEMO_FILE2, project_id: DEMO_PROJECT, session_id: DEMO_SESSION,
  uploaded_by: DEMO_USER_ID, uploader_name: 'Demo Producer',
  r2_key: `projects/${DEMO_PROJECT}/${DEMO_FILE2}/bass_stem.wav`,
  file_url: 'https://example.com/bass_stem.wav',
  filename: 'bass_stem.wav', original_name: 'Bass Stem (48kHz).wav',
  mime_type: 'audio/wav', size_bytes: 52_000_000,
  file_type: 'audio', daw_type: null,
  duration_ms: 240000, sample_rate: 48000, bit_depth: 24, channels: 2,
  bpm: 96, time_signature: '4/4',
  start_timecode: '00:00:01:500', offset_ms: 1500, timeline_track: 1,
  is_locked: 0, is_muted: 0, group_id: null,
  analyzed: 1, leading_silence_ms: 200, first_transient_ms: 1500,
  waveform_data: Array.from({ length: 200 }, () => Math.random() * 0.6 + 0.05),
  bwf_timecode: null, version: 2, parent_file_id: null,
  download_count: 1, download_limit: null, expires_at: null,
  processing_status: 'complete', processing_error: null,
  created_at: '2025-03-01T13:00:00Z', updated_at: '2025-03-01T13:01:00Z',
});

// Add demo file to proj-002
const DEMO_FILE3 = 'file-003';
files.set(DEMO_FILE3, {
  id: DEMO_FILE3, project_id: DEMO_PROJECT2, session_id: null,
  uploaded_by: DEMO_USER_ID, uploader_name: 'Demo Producer',
  r2_key: `projects/${DEMO_PROJECT2}/${DEMO_FILE3}/808_loop.wav`,
  file_url: 'https://example.com/808_loop.wav',
  filename: '808_loop.wav', original_name: '808 Loop 140bpm.wav',
  mime_type: 'audio/wav', size_bytes: 12_000_000,
  file_type: 'audio', daw_type: null,
  duration_ms: 32000, sample_rate: 44100, bit_depth: 24, channels: 2,
  bpm: 140, time_signature: '4/4',
  start_timecode: '00:00:00:000', offset_ms: 0, timeline_track: 0,
  is_locked: 0, is_muted: 0, group_id: null,
  analyzed: 1, leading_silence_ms: 0, first_transient_ms: 5,
  waveform_data: Array.from({ length: 200 }, () => Math.random() * 0.9),
  bwf_timecode: null, version: 1, parent_file_id: null,
  download_count: 0, download_limit: null, expires_at: null,
  processing_status: 'complete', processing_error: null,
  created_at: '2025-02-10T11:00:00Z', updated_at: '2025-02-10T11:00:00Z',
});

// Seed activity
const ACTIONS = [
  { action: 'file_upload',   entity_type: 'file',    entity_id: DEMO_FILE1, metadata: { filename: 'Kick Stem (48kHz).wav' } },
  { action: 'file_upload',   entity_type: 'file',    entity_id: DEMO_FILE2, metadata: { filename: 'Bass Stem (48kHz).wav' } },
  { action: 'session_create',entity_type: 'session', entity_id: DEMO_SESSION, metadata: {} },
  { action: 'project_create',entity_type: 'project', entity_id: DEMO_PROJECT, metadata: {} },
];
ACTIONS.forEach((a, i) => activity.push({
  id: `act-${i}`, project_id: DEMO_PROJECT, user_id: DEMO_USER_ID,
  user_name: 'Demo Producer', avatar_url: null,
  ...a, ip_address: null,
  created_at: new Date(Date.now() - i * 3_600_000).toISOString(),
}));

// ── Router ───────────────────────────────────────────────────────────────────
function route(method, pathname, handlers) {
  const key = `${method}:${pathname}`;
  handlers[key] = true;
}

function respond(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Upload-Id, X-Chunk-Index, X-File-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  });
  res.end(json);
}

function getBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
  });
}

function getUserFromReq(req) {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const uid = tokens.get(token);
  if (!uid)  return null;
  return users.get(uid) ?? null;
}

// ── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, 'http://localhost:8788');
  const pathname = url.pathname;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Upload-Id, X-Chunk-Index, X-File-Id',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    });
    return res.end();
  }

  // ── AUTH ────────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/auth/register') {
    const body = await getBody(req);
    const id   = 'user-' + crypto.randomUUID().slice(0, 8);
    const user = { id, email: body.email, name: body.name, role: 'user', plan: 'free',
                   storage_used: 0, storage_limit_bytes: 5_368_709_120,
                   upload_limit_bytes: 524_288_000, max_projects: 3,
                   created_at: new Date().toISOString() };
    users.set(id, user);
    const token = crypto.randomUUID();
    tokens.set(token, id);
    return respond(res, 201, { token, user });
  }

  if (method === 'POST' && pathname === '/auth/login') {
    const body = await getBody(req);
    // Accept any credentials in dev — return demo user for demo@stemfer.com
    if (body.email === 'demo@stemfer.com') {
      return respond(res, 200, { token: DEMO_TOKEN, user: users.get(DEMO_USER_ID) });
    }
    // Create a session for any other credentials (dev mode)
    const user = [...users.values()].find(u => u.email === body.email);
    if (user) {
      const token = crypto.randomUUID();
      tokens.set(token, user.id);
      return respond(res, 200, { token, user });
    }
    return respond(res, 401, { error: 'Invalid credentials — use demo@stemfer.com / any password' });
  }

  if (method === 'GET' && pathname === '/auth/me') {
    const user = getUserFromReq(req);
    if (!user) return respond(res, 401, { error: 'Unauthorized' });
    return respond(res, 200, user);
  }

  if (method === 'POST' && pathname === '/auth/logout') {
    return respond(res, 200, { ok: true });
  }

  // ── PROJECTS ────────────────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/projects') {
    const user = getUserFromReq(req);
    if (!user) return respond(res, 401, { error: 'Unauthorized' });
    const list = [...projects.values()].filter(p => p.owner_id === user.id || p.owner_id === DEMO_USER_ID);
    return respond(res, 200, list);
  }

  if (method === 'POST' && pathname === '/projects') {
    const user = getUserFromReq(req);
    if (!user) return respond(res, 401, { error: 'Unauthorized' });
    const body = await getBody(req);
    const id   = 'proj-' + crypto.randomUUID().slice(0, 8);
    const proj = {
      id, owner_id: user.id, team_id: null,
      name: body.name, description: body.description ?? null,
      color: body.color ?? '#22c55e', bpm: body.bpm ?? null,
      time_sig: body.time_sig ?? '4/4', sample_rate: body.sample_rate ?? 48000,
      status: 'active', member_role: 'owner', file_count: 0, session_count: 0,
      is_public: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    projects.set(id, proj);
    return respond(res, 201, proj);
  }

  const projMatch = pathname.match(/^\/projects\/([^/]+)$/);
  if (projMatch) {
    const id   = projMatch[1];
    const proj = projects.get(id);

    if (method === 'GET') {
      if (!proj) return respond(res, 404, { error: 'Not found' });
      return respond(res, 200, proj);
    }
    if (method === 'PATCH') {
      if (!proj) return respond(res, 404, { error: 'Not found' });
      const body   = await getBody(req);
      const updated = { ...proj, ...body, updated_at: new Date().toISOString() };
      projects.set(id, updated);
      return respond(res, 200, updated);
    }
    if (method === 'DELETE') {
      projects.delete(id);
      return respond(res, 200, { ok: true });
    }
  }

  const membersMatch = pathname.match(/^\/projects\/([^/]+)\/members$/);
  if (membersMatch) {
    const id = membersMatch[1];
    if (method === 'GET') return respond(res, 200, [
      { id: DEMO_USER_ID, name: 'Demo Producer', email: 'demo@stemfer.com', avatar_url: null, role: 'owner', added_at: '2025-01-01T00:00:00Z' }
    ]);
    if (method === 'POST') return respond(res, 200, { ok: true });
  }

  const sessionsMatch = pathname.match(/^\/projects\/([^/]+)\/sessions$/);
  if (sessionsMatch) {
    const projId = sessionsMatch[1];
    if (method === 'GET') {
      const list = [...sessions.values()].filter(s => s.project_id === projId);
      return respond(res, 200, list);
    }
    if (method === 'POST') {
      const body = await getBody(req);
      const id   = 'sess-' + crypto.randomUUID().slice(0, 8);
      const sess = { id, project_id: projId, name: body.name, description: body.description ?? null,
                     bpm: body.bpm ?? null, time_sig: body.time_sig ?? null,
                     sample_rate: body.sample_rate ?? 48000, status: 'draft', file_count: 0,
                     created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      sessions.set(id, sess);
      return respond(res, 201, sess);
    }
  }

  const activityMatch = pathname.match(/^\/projects\/([^/]+)\/activity$/);
  if (activityMatch) {
    const projId = activityMatch[1];
    const list   = activity.filter(a => a.project_id === projId);
    return respond(res, 200, list);
  }

  // ── FILES ───────────────────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/files') {
    const user      = getUserFromReq(req);
    if (!user) return respond(res, 401, { error: 'Unauthorized' });
    const projectId = url.searchParams.get('projectId');
    const sessionId = url.searchParams.get('sessionId');
    let list = [...files.values()].filter(f => f.project_id === projectId && f.processing_status !== 'deleted');
    if (sessionId) list = list.filter(f => f.session_id === sessionId);
    return respond(res, 200, list);
  }

  const fileMatch = pathname.match(/^\/files\/([^/]+)$/);
  if (fileMatch) {
    const id   = fileMatch[1];
    const file = files.get(id);

    if (method === 'GET') {
      if (!file) return respond(res, 404, { error: 'Not found' });
      return respond(res, 200, file);
    }
    if (method === 'PATCH') {
      if (!file) return respond(res, 404, { error: 'Not found' });
      const body    = await getBody(req);
      const updated = { ...file, ...body, updated_at: new Date().toISOString() };
      files.set(id, updated);
      return respond(res, 200, updated);
    }
    if (method === 'DELETE') {
      if (file) { files.set(id, { ...file, processing_status: 'deleted' }); }
      return respond(res, 200, { ok: true });
    }
  }

  const fileVersionsMatch = pathname.match(/^\/files\/([^/]+)\/versions$/);
  if (fileVersionsMatch) {
    const id   = fileVersionsMatch[1];
    const file = files.get(id);
    if (!file) return respond(res, 404, { error: 'Not found' });
    return respond(res, 200, [{ id: file.id, version: file.version, size_bytes: file.size_bytes,
                                created_at: file.created_at, processing_status: file.processing_status }]);
  }

  // ── UPLOAD ──────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/upload/init') {
    const user = getUserFromReq(req);
    if (!user) return respond(res, 401, { error: 'Unauthorized' });
    const body    = await getBody(req);
    const fileId  = 'file-' + crypto.randomUUID().slice(0, 8);
    const uploadId = 'upload-' + crypto.randomUUID().slice(0, 8);
    const CHUNK   = 5 * 1024 * 1024;
    const total   = Math.ceil(body.size / CHUNK);
    const r2Key   = `projects/${body.projectId}/${fileId}/${body.filename}`;
    // Pre-create file record
    files.set(fileId, {
      id: fileId, project_id: body.projectId, session_id: body.sessionId ?? null,
      uploaded_by: user.id, uploader_name: user.name,
      r2_key: r2Key, file_url: '', filename: body.filename, original_name: body.filename,
      mime_type: body.mimeType ?? 'audio/wav', size_bytes: body.size,
      file_type: 'audio', daw_type: null,
      duration_ms: null, sample_rate: null, bit_depth: null, channels: null,
      bpm: null, time_signature: null,
      start_timecode: '00:00:00:000', offset_ms: 0, timeline_track: 0,
      is_locked: 0, is_muted: 0, group_id: null,
      analyzed: 0, leading_silence_ms: null, first_transient_ms: null,
      waveform_data: [], bwf_timecode: null,
      version: 1, parent_file_id: null,
      download_count: 0, download_limit: null, expires_at: null,
      processing_status: 'pending', processing_error: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return respond(res, 201, { uploadId, fileId, r2Key, totalChunks: total, chunkSize: CHUNK });
  }

  if (method === 'POST' && pathname === '/upload/chunk') {
    // Accept chunk bytes and return a fake etag
    await new Promise(r => req.on('data', () => {}).on('end', r));
    const idx = parseInt(req.headers['x-chunk-index'] ?? '0');
    return respond(res, 200, { partNumber: idx + 1, etag: `etag-${idx}` });
  }

  if (method === 'POST' && pathname === '/upload/complete') {
    const body = await getBody(req);
    const file = files.get(body.fileId);
    if (file) {
      // Simulate analysis completion with mock waveform data
      const mockWaveform = Array.from({ length: 200 }, () => Math.random() * 0.8 + 0.1);
      files.set(body.fileId, {
        ...file,
        file_url: `http://localhost:8788/mock-file/${body.fileId}`,
        processing_status: 'complete',
        analyzed: 1,
        duration_ms: 180000,
        sample_rate: 48000,
        bit_depth: 24,
        channels: 2,
        leading_silence_ms: Math.floor(Math.random() * 500),
        first_transient_ms: Math.floor(Math.random() * 2000),
        waveform_data: mockWaveform,
        updated_at: new Date().toISOString(),
      });
      // Update project file count
      const proj = projects.get(file.project_id);
      if (proj) projects.set(proj.id, { ...proj, file_count: proj.file_count + 1 });
    }
    return respond(res, 200, { ok: true, fileId: body.fileId, fileUrl: `http://localhost:8788/mock-file/${body.fileId}` });
  }

  if (method === 'POST' && pathname === '/upload/abort') {
    const body = await getBody(req);
    files.delete(body.fileId);
    return respond(res, 200, { ok: true });
  }

  // ── SUBSCRIPTIONS ───────────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/subscriptions/me') {
    const user = getUserFromReq(req);
    if (!user) return respond(res, 401, { error: 'Unauthorized' });
    return respond(res, 200, {
      id: 'sub-001', user_id: user.id, plan: user.plan, status: 'active',
      storage_limit_bytes: user.storage_limit_bytes,
      upload_limit_bytes: user.upload_limit_bytes,
      max_projects: user.max_projects, team_seats: 1,
      current_period_end: '2026-06-01T00:00:00Z', cancel_at_period_end: false,
    });
  }

  if (method === 'POST' && pathname === '/subscriptions/checkout') {
    return respond(res, 200, { url: 'https://stripe.com/checkout/mock', sessionId: 'cs_mock' });
  }

  if (method === 'POST' && pathname === '/subscriptions/portal') {
    return respond(res, 200, { url: 'https://billing.stripe.com/mock' });
  }

  // ── HEALTH / fallback ───────────────────────────────────────────────────────
  if (pathname === '/health') return respond(res, 200, { ok: true, ts: Date.now(), env: 'local-mock' });

  // 404
  console.log(`  [mock] ${method} ${pathname} → 404`);
  respond(res, 404, { error: `No mock route: ${method} ${pathname}` });
});

server.listen(8788, () => {
  console.log('');
  console.log('  ✅  Stemfer Mock API running at http://localhost:8788');
  console.log('');
  console.log('  Demo credentials:');
  console.log('    Email:    demo@stemfer.com');
  console.log('    Password: anything');
  console.log('');
});
