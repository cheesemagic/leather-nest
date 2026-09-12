import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import formidable from 'formidable';
import { createStore } from './src/skins/store.js';
import { rankMatches } from './src/skins/similarity.js';
import { createStore as createDieStore } from './src/dies/store.js';
import { parseSVGPolygon } from './src/svg/parse.js';
import { createStore as createSessionStore } from './src/sessions/store.js';
import { polygonArea } from './src/nesting/geometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const PYTHON = path.join(__dirname, 'venv', 'bin', 'python3');
const DIGITIZE_SCRIPT = path.join(__dirname, 'scripts', 'digitize.py');
const SKIN_SIGNATURE_SCRIPT = path.join(__dirname, 'scripts', 'skin_signature.py');
const BLOTCH_MATCH_SCRIPT = path.join(__dirname, 'scripts', 'blotch_match.py');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/public/index.html' : req.url;
  const filePath = path.join(__dirname, urlPath);

  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function parseForm(req) {
  const form = formidable({});
  const [fields, files] = await form.parse(req);
  return { fields, files };
}

function cleanupFiles(files) {
  for (const fileList of Object.values(files)) {
    for (const file of fileList) {
      fs.unlink(file.filepath, () => {});
    }
  }
}

function numberOrNull(raw) {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Comma-separated is friendlier to type than JSON in a multipart form.
// An empty value means "any species", stored as null rather than [] so
// "unconstrained" stays distinguishable from "constrained to nothing".
function speciesOrNull(raw) {
  if (!raw) return null;
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : null;
}

// undefined lets the store apply its own default rather than overwriting
// it with an empty list.
function rotationsOrUndefined(raw) {
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  return list.length ? list : undefined;
}

// POST /dies/:id is the trust boundary for JSON updates — validate here so
// every caller inherits the check, store.update() stays a dumb writer.
//
// Do NOT reuse numberOrNull/speciesOrNull/rotationsOrUndefined above: they're
// built for multipart *strings* and misbehave on real JSON values.
// numberOrNull(null) returns 0 (Number(null) === 0), which would silently
// turn a deliberate "clear this value" into a stored 0. speciesOrNull calls
// .split() on its argument, which throws on an actual array.
function validateDieUpdate(payload, existing) {
  const result = {};

  if ('name' in payload) {
    const { name } = payload;
    if (typeof name !== 'string' || name.trim() === '') {
      return { error: 'name must be a non-empty string.' };
    }
    result.name = name.trim();
  }

  if ('productFamily' in payload) {
    const { productFamily } = payload;
    if (productFamily !== null && typeof productFamily !== 'string') {
      return { error: 'productFamily must be a string or null.' };
    }
    const trimmed = productFamily === null ? null : productFamily.trim();
    result.productFamily = trimmed === '' ? null : trimmed;
  }

  for (const field of ['valuePerPiece', 'thicknessMinMm', 'thicknessMaxMm']) {
    if (field in payload) {
      const value = payload[field];
      if (value !== null && !(typeof value === 'number' && Number.isFinite(value))) {
        return { error: `${field} must be a number or null.` };
      }
      if (field === 'valuePerPiece' && value !== null && value < 0) {
        return { error: 'valuePerPiece must not be negative.' };
      }
      result[field] = value;
    }
  }

  if ('demand' in payload) {
    const { demand } = payload;
    if (!(typeof demand === 'number' && Number.isFinite(demand)) || demand < 0) {
      return { error: 'demand must be a finite number >= 0.' };
    }
    result.demand = demand;
  }

  if ('allowedSpecies' in payload) {
    const { allowedSpecies } = payload;
    if (allowedSpecies !== null && !Array.isArray(allowedSpecies)) {
      return { error: 'allowedSpecies must be an array of strings or null.' };
    }
    if (allowedSpecies === null) {
      result.allowedSpecies = null;
    } else {
      if (!allowedSpecies.every((s) => typeof s === 'string')) {
        return { error: 'allowedSpecies must be an array of strings or null.' };
      }
      const normalized = allowedSpecies.map((s) => s.trim().toLowerCase()).filter(Boolean);
      result.allowedSpecies = normalized.length ? normalized : null;
    }
  }

  if ('allowedRotations' in payload) {
    const { allowedRotations } = payload;
    const valid =
      Array.isArray(allowedRotations) &&
      allowedRotations.length > 0 &&
      allowedRotations.every((n) => typeof n === 'number' && Number.isFinite(n));
    if (!valid) {
      return { error: 'allowedRotations must be a non-empty array of numbers.' };
    }
    result.allowedRotations = allowedRotations;
  }

  // Compare against the stored values for whichever side isn't being
  // updated, so a partial update can't create an inverted range.
  const minMm = 'thicknessMinMm' in result ? result.thicknessMinMm : existing.thicknessMinMm;
  const maxMm = 'thicknessMaxMm' in result ? result.thicknessMaxMm : existing.thicknessMaxMm;
  if (minMm != null && maxMm != null && minMm > maxMm) {
    return { error: 'thicknessMinMm must not be greater than thicknessMaxMm.' };
  }

  return { value: result };
}

async function handleDigitize(req, res) {
  let fields, files;
  try {
    ({ fields, files } = await parseForm(req));
  } catch {
    sendJSON(res, 400, { error: 'Could not parse upload.' });
    return;
  }

  const photo = files.photo && files.photo[0];
  if (!photo) {
    cleanupFiles(files);
    sendJSON(res, 400, { error: 'No photo uploaded.' });
    return;
  }

  const getField = (name) => fields[name] && fields[name][0];
  const args = [
    DIGITIZE_SCRIPT,
    photo.filepath,
    getField('p1x'),
    getField('p1y'),
    getField('p2x'),
    getField('p2y'),
    getField('realDistanceMm'),
  ];

  execFile(PYTHON, args, (err, stdout, stderr) => {
    fs.unlink(photo.filepath, () => {});

    if (err) {
      sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(stdout);
  });
}

function createSkinsRoutes(dataDir) {
  const store = createStore(dataDir);

  async function handleCreateSkin(req, res) {
    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse upload.' });
      return;
    }

    const photo = files.photo && files.photo[0];
    if (!photo) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: 'No photo uploaded.' });
      return;
    }

    const getField = (name) => fields[name] && fields[name][0];
    const label = getField('label');
    const species = getField('species');
    if (!label || !species) {
      fs.unlink(photo.filepath, () => {});
      sendJSON(res, 400, { error: 'label and species are required.' });
      return;
    }

    const captureType = getField('captureType') || 'signature';
    const photoExt = path.extname(photo.originalFilename || '') || '.jpg';

    if (captureType === 'outline') {
      const thicknessMmRaw = getField('thicknessMm');
      if (!thicknessMmRaw) {
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 400, { error: 'thicknessMm is required.' });
        return;
      }

      const roiFields = ['roiX', 'roiY', 'roiWidth', 'roiHeight'];
      const hasROI = roiFields.every((field) => getField(field));
      const args = [
        DIGITIZE_SCRIPT,
        photo.filepath,
        getField('p1x'),
        getField('p1y'),
        getField('p2x'),
        getField('p2y'),
        getField('realDistanceMm'),
        ...(hasROI ? roiFields.map(getField) : []),
      ];

      execFile(PYTHON, args, (err, stdout, stderr) => {
        if (err) {
          fs.unlink(photo.filepath, () => {});
          sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
          return;
        }
        const { polygon } = JSON.parse(stdout);
        const record = store.create({
          label,
          species,
          thicknessMm: Number(thicknessMmRaw),
          outlinePolygon: polygon,
          photoPath: photo.filepath,
          photoExt,
        });
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 200, record);
      });
      return;
    }

    if (captureType !== 'signature') {
      fs.unlink(photo.filepath, () => {});
      sendJSON(res, 400, { error: 'captureType must be "signature" or "outline".' });
      return;
    }

    const args = [
      SKIN_SIGNATURE_SCRIPT,
      photo.filepath,
      getField('roiX'),
      getField('roiY'),
      getField('roiWidth'),
      getField('roiHeight'),
      getField('p1x'),
      getField('p1y'),
      getField('p2x'),
      getField('p2y'),
      getField('realDistanceMm'),
    ];

    execFile(PYTHON, args, (err, stdout, stderr) => {
      if (err) {
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 422, { error: stderr.trim() || 'Signature computation failed.' });
        return;
      }

      const { dominantWavelengthMm, radialSpectrum } = JSON.parse(stdout);
      const record = store.create({
        label,
        species,
        dominantWavelengthMm,
        radialSpectrum,
        photoPath: photo.filepath,
        photoExt,
      });
      fs.unlink(photo.filepath, () => {});

      sendJSON(res, 200, record);
    });
  }

  function handleListSkins(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleMatchSkins(req, res) {
    sendJSON(res, 200, rankMatches(store.list()));
  }

  function handleDeleteSkin(req, res, id) {
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  function handleSkinPhoto(req, res, id) {
    const photoPath = store.photoPath(id);
    if (!photoPath) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }
    fs.readFile(photoPath, (err, data) => {
      if (err) {
        sendJSON(res, 404, { error: 'Skin not found.' });
        return;
      }
      const ext = path.extname(photoPath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  return { handleCreateSkin, handleListSkins, handleMatchSkins, handleDeleteSkin, handleSkinPhoto };
}

function createDiesRoutes(dataDir) {
  const store = createDieStore(dataDir);

  async function handleCreateDie(req, res) {
    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse upload.' });
      return;
    }

    const getField = (name) => fields[name] && fields[name][0];
    const name = getField('name');
    const svgFile = files.svg && files.svg[0];
    const photoFile = files.photo && files.photo[0];
    const widthRaw = getField('widthMm');
    const heightRaw = getField('heightMm');
    const hasDimensions = widthRaw !== undefined || heightRaw !== undefined;

    if (!name || (!svgFile && !photoFile && !hasDimensions)) {
      cleanupFiles(files);
      sendJSON(res, 400, {
        error:
          'name and either an svg file, a photo with calibration, or widthMm and heightMm are required.',
      });
      return;
    }

    const metadata = {
      valuePerPiece: numberOrNull(getField('valuePerPiece')),
      productFamily: getField('productFamily') || null,
      allowedSpecies: speciesOrNull(getField('allowedSpecies')),
      thicknessMinMm: numberOrNull(getField('thicknessMinMm')),
      thicknessMaxMm: numberOrNull(getField('thicknessMaxMm')),
      allowedRotations: rotationsOrUndefined(getField('allowedRotations')),
      demand: numberOrNull(getField('demand')) ?? 0,
    };

    if (svgFile) {
      const svgContent = fs.readFileSync(svgFile.filepath, 'utf8');
      fs.unlink(svgFile.filepath, () => {});
      try {
        const polygon = parseSVGPolygon(svgContent);
        sendJSON(res, 200, store.create({ name, polygon, ...metadata }));
      } catch (err) {
        sendJSON(res, 422, { error: err.message });
      }
      return;
    }

    if (!photoFile) {
      const widthMm = Number(widthRaw);
      const heightMm = Number(heightRaw);
      if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
        sendJSON(res, 400, { error: 'widthMm and heightMm must both be positive numbers.' });
        return;
      }
      const polygon = [
        { x: 0, y: 0 },
        { x: widthMm, y: 0 },
        { x: widthMm, y: heightMm },
        { x: 0, y: heightMm },
      ];
      sendJSON(res, 200, store.create({ name, polygon, ...metadata }));
      return;
    }

    const roiFields = ['roiX', 'roiY', 'roiWidth', 'roiHeight'];
    if (roiFields.some((field) => !getField(field))) {
      fs.unlink(photoFile.filepath, () => {});
      sendJSON(res, 400, { error: 'roiX, roiY, roiWidth, and roiHeight are required when adding a die from a photo.' });
      return;
    }

    const args = [
      DIGITIZE_SCRIPT,
      photoFile.filepath,
      getField('p1x'),
      getField('p1y'),
      getField('p2x'),
      getField('p2y'),
      getField('realDistanceMm'),
      getField('roiX'),
      getField('roiY'),
      getField('roiWidth'),
      getField('roiHeight'),
    ];
    execFile(PYTHON, args, (err, stdout, stderr) => {
      fs.unlink(photoFile.filepath, () => {});
      if (err) {
        sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
        return;
      }
      const { polygon } = JSON.parse(stdout);
      sendJSON(res, 200, store.create({ name, polygon, ...metadata }));
    });
  }

  function handleListDies(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleDeleteDie(req, res, id) {
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Die not found.' });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  async function handleUpdateDie(req, res, id) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }
    if (!payload || typeof payload !== 'object') {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }

    const existing = store.list().find((d) => d.id === id);
    if (!existing) {
      sendJSON(res, 404, { error: 'Die not found.' });
      return;
    }

    const { error, value } = validateDieUpdate(payload, existing);
    if (error) {
      sendJSON(res, 400, { error });
      return;
    }

    // store.update() reads the record and writes it synchronously, after
    // this await — so there is no read-before-await window of the kind the
    // jobs status route had to close.
    const updated = store.update(id, value);
    if (!updated) {
      sendJSON(res, 404, { error: 'Die not found.' });
      return;
    }
    sendJSON(res, 200, updated);
  }

  return { handleCreateDie, handleListDies, handleDeleteDie, handleUpdateDie };
}

function createSessionsRoutes(dataDir, diesDataDir, skinsDataDir) {
  const store = createSessionStore(dataDir);
  const dieStore = createDieStore(diesDataDir);
  const skinStore = createStore(skinsDataDir);

  // Rotation and translation preserve area, so the raw die polygon is
  // exact for every placement of it. A placement is one instance, plus a
  // second when the blotch search found a matching twin.
  function consumedAreaMm2(session) {
    return session.placements.reduce(
      (sum, p) => sum + polygonArea(p.polygon) * (p.match ? 2 : 1),
      0
    );
  }

  // Skips the adjustment (no hide linked, hide deleted, or a
  // signature-only hide with no outline to measure) rather than erroring —
  // an operator must still be able to record work they actually did.
  function applyAreaDelta(hideId, deltaMm2) {
    if (!hideId) return;
    const hide = skinStore.list().find((h) => h.id === hideId);
    if (!hide || !hide.outlinePolygon) return;
    const hideArea = polygonArea(hide.outlinePolygon);
    if (hideArea <= 0) return;
    const current = hide.remainingAreaPct ?? 100;
    skinStore.setRemainingAreaPct(hideId, current + (deltaMm2 / hideArea) * 100);
  }

  async function handleCreateSession(req, res) {
    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse upload.' });
      return;
    }

    const photo = files.photo && files.photo[0];
    if (!photo) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: 'No photo uploaded.' });
      return;
    }

    const getField = (name) => fields[name] && fields[name][0];
    const calibration = {
      p1x: Number(getField('p1x')),
      p1y: Number(getField('p1y')),
      p2x: Number(getField('p2x')),
      p2y: Number(getField('p2y')),
      realDistanceMm: Number(getField('realDistanceMm')),
    };
    const searchRegion = {
      roiX: Number(getField('roiX')),
      roiY: Number(getField('roiY')),
      roiWidth: Number(getField('roiWidth')),
      roiHeight: Number(getField('roiHeight')),
    };

    const photoExt = path.extname(photo.originalFilename || '') || '.jpg';
    const record = store.create({
      hideId: getField('hideId') || null,
      calibration,
      searchRegion,
      photoPath: photo.filepath,
      photoExt,
    });
    fs.unlink(photo.filepath, () => {});
    sendJSON(res, 200, record);
  }

  function handleListSessions(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleGetSession(req, res, id) {
    const record = store.list().find((s) => s.id === id);
    if (!record) {
      sendJSON(res, 404, { error: 'Session not found.' });
      return;
    }
    sendJSON(res, 200, record);
  }

  function handleDeleteSession(req, res, id) {
    const session = store.list().find((s) => s.id === id);
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Session not found.' });
      return;
    }
    if (session.status === 'cut') {
      applyAreaDelta(session.hideId, session.consumedAreaMm2 ?? 0);
    }
    res.writeHead(204);
    res.end();
  }

  async function handleSetSessionStatus(req, res, id) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }

    const session = store.list().find((s) => s.id === id);
    if (!session) {
      sendJSON(res, 404, { error: 'Session not found.' });
      return;
    }

    const status = payload && payload.status;
    if (status !== 'cut' && status !== 'draft') {
      sendJSON(res, 400, { error: 'status must be "cut" or "draft".' });
      return;
    }

    const current = session.status || 'draft';
    if (status === current) {
      sendJSON(res, 400, { error: `Job is already ${current}.` });
      return;
    }

    if (status === 'cut') {
      const consumed = consumedAreaMm2(session);
      applyAreaDelta(session.hideId, -consumed);
      sendJSON(res, 200, store.setStatus(id, {
        status: 'cut',
        cutAt: new Date().toISOString(),
        consumedAreaMm2: consumed,
      }));
      return;
    }

    // Restoring the amount actually subtracted, rather than recomputing
    // it, keeps un-cut exact even if the hide or placements changed since.
    applyAreaDelta(session.hideId, session.consumedAreaMm2 ?? 0);
    sendJSON(res, 200, store.setStatus(id, { status: 'draft', cutAt: null, consumedAreaMm2: null }));
  }

  function handleSessionPhoto(req, res, id) {
    const photoPath = store.photoPath(id);
    if (!photoPath) {
      sendJSON(res, 404, { error: 'Session not found.' });
      return;
    }
    fs.readFile(photoPath, (err, data) => {
      if (err) {
        sendJSON(res, 404, { error: 'Session not found.' });
        return;
      }
      const ext = path.extname(photoPath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  async function handleCreatePlacement(req, res, id) {
    const session = store.list().find((s) => s.id === id);
    if (!session) {
      sendJSON(res, 404, { error: 'Session not found.' });
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }
    if (!payload || typeof payload !== 'object') {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }

    const { dieId, x, y, rotation } = payload;
    const die = dieStore.list().find((d) => d.id === dieId);
    if (!die) {
      sendJSON(res, 404, { error: 'Die not found.' });
      return;
    }

    const occupied = session.placements.flatMap((p) => {
      const entries = [];
      entries.push({ polygon: p.polygon, x: p.reference.x, y: p.reference.y, rotation: p.reference.rotation });
      if (p.match) entries.push({ polygon: p.polygon, x: p.match.x, y: p.match.y, rotation: p.match.rotation });
      return entries;
    });

    const scriptPayload = {
      imagePath: store.photoPath(id),
      calibration: session.calibration,
      searchRegion: session.searchRegion,
      diePolygon: die.polygon,
      referencePlacement: { x, y, rotation },
      occupied,
    };

    const child = execFile(PYTHON, [BLOTCH_MATCH_SCRIPT], { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) {
        sendJSON(res, 422, { error: stderr.trim() || 'Search failed.' });
        return;
      }
      let match;
      try {
        ({ match } = JSON.parse(stdout));
      } catch {
        sendJSON(res, 422, { error: 'Search produced an unreadable result.' });
        return;
      }
      const updated = store.addPlacement(id, {
        dieId,
        dieName: die.name,
        polygon: die.polygon,
        reference: { x, y, rotation },
        match,
      });
      sendJSON(res, 200, updated);
    });
    child.stdin.end(JSON.stringify(scriptPayload));
  }

  return {
    handleCreateSession,
    handleListSessions,
    handleGetSession,
    handleDeleteSession,
    handleSessionPhoto,
    handleCreatePlacement,
    handleSetSessionStatus,
  };
}

export function createServer({
  dataDir = path.join(__dirname, 'data', 'skins'),
  diesDataDir = path.join(__dirname, 'data', 'dies'),
  sessionsDataDir = path.join(__dirname, 'data', 'sessions'),
} = {}) {
  const skins = createSkinsRoutes(dataDir);
  const dies = createDiesRoutes(diesDataDir);
  const sessions = createSessionsRoutes(sessionsDataDir, diesDataDir, dataDir);

  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/digitize') {
      handleDigitize(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/skins') {
      skins.handleCreateSkin(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/skins') {
      skins.handleListSkins(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/skins/matches') {
      skins.handleMatchSkins(req, res);
      return;
    }
    const photoMatch = req.method === 'GET' && req.url.match(/^\/skins\/([^/]+)\/photo$/);
    if (photoMatch) {
      skins.handleSkinPhoto(req, res, photoMatch[1]);
      return;
    }
    const skinDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/skins\/([^/]+)$/);
    if (skinDeleteMatch) {
      skins.handleDeleteSkin(req, res, skinDeleteMatch[1]);
      return;
    }
    if (req.method === 'POST' && req.url === '/dies') {
      dies.handleCreateDie(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/dies') {
      dies.handleListDies(req, res);
      return;
    }
    const dieUpdateMatch = req.method === 'POST' && req.url.match(/^\/dies\/([^/]+)$/);
    if (dieUpdateMatch) {
      dies.handleUpdateDie(req, res, dieUpdateMatch[1]);
      return;
    }
    const dieDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/dies\/([^/]+)$/);
    if (dieDeleteMatch) {
      dies.handleDeleteDie(req, res, dieDeleteMatch[1]);
      return;
    }
    if (req.method === 'POST' && req.url === '/sessions') {
      sessions.handleCreateSession(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/sessions') {
      sessions.handleListSessions(req, res);
      return;
    }
    const sessionPhotoMatch = req.method === 'GET' && req.url.match(/^\/sessions\/([^/]+)\/photo$/);
    if (sessionPhotoMatch) {
      sessions.handleSessionPhoto(req, res, sessionPhotoMatch[1]);
      return;
    }
    const placementMatch = req.method === 'POST' && req.url.match(/^\/sessions\/([^/]+)\/placements$/);
    if (placementMatch) {
      sessions.handleCreatePlacement(req, res, placementMatch[1]);
      return;
    }
    const statusMatch = req.method === 'POST' && req.url.match(/^\/sessions\/([^/]+)\/status$/);
    if (statusMatch) {
      sessions.handleSetSessionStatus(req, res, statusMatch[1]);
      return;
    }
    const sessionGetMatch = req.method === 'GET' && req.url.match(/^\/sessions\/([^/]+)$/);
    if (sessionGetMatch) {
      sessions.handleGetSession(req, res, sessionGetMatch[1]);
      return;
    }
    const sessionDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/sessions\/([^/]+)$/);
    if (sessionDeleteMatch) {
      sessions.handleDeleteSession(req, res, sessionDeleteMatch[1]);
      return;
    }
    serveStatic(req, res);
  });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`leather-nest dev server running at http://localhost:${PORT}`);
  });
}
