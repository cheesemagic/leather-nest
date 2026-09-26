import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import formidable from 'formidable';
import { createStore } from './src/skins/store.js';
import { rankMatches } from './src/skins/similarity.js';
import { createStore as createPartStore } from './src/parts/store.js';
import { createStore as createProductStore } from './src/products/store.js';
import { createStore as createCalibrationStore } from './src/calibrations/store.js';
import { parseSVGPolygon, parseSVGComponents, unitOptions } from './src/svg/parse.js';
import { createStore as createSessionStore } from './src/sessions/store.js';
import { polygonArea } from './src/nesting/geometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const PYTHON = path.join(__dirname, 'venv', 'bin', 'python3');
const DIGITIZE_SCRIPT = path.join(__dirname, 'scripts', 'digitize.py');
const SKIN_SIGNATURE_SCRIPT = path.join(__dirname, 'scripts', 'skin_signature.py');
const COLOUR_SAMPLE_SCRIPT = path.join(__dirname, 'scripts', 'colour_sample.py');
const BLOTCH_MATCH_SCRIPT = path.join(__dirname, 'scripts', 'blotch_match.py');

// Every Python call gets a timeout, because none of them had one. The blotch
// search is what made this urgent -- measured at 52-65s on a full-resolution
// phone photo, with no progress indicator -- but a wedged OpenCV call on ANY
// script held its request open forever, and the operator's only signal was a
// page that never came back.
//
// Three minutes is roughly 3x the slowest measured real run. It is a ceiling
// on a hang, not a performance target: a search legitimately taking longer
// than this means the photo is bigger than anything yet tested, and the
// answer then is a progress indicator, not a larger number here.
const PYTHON_TIMEOUT_MS = 180_000;

// Exported for its test. Wraps execFile so the timeout cannot be forgotten at
// a call site -- it was missing from all nine of them -- and so that a
// timeout reads as one. Node reports a killed child with an empty stderr, and
// every handler here surfaces `stderr.trim() || <generic fallback>`, so
// without this substitution a three-minute hang would surface as "Search
// failed." with no hint that time was the problem.
export function execPython(args, optionsOrCallback, maybeCallback) {
  const callback = maybeCallback ?? optionsOrCallback;
  const options = maybeCallback ? optionsOrCallback : {};
  const timeoutMs = options.timeout ?? PYTHON_TIMEOUT_MS;

  return execFile(PYTHON, args, { ...options, timeout: timeoutMs }, (err, stdout, stderr) => {
    if (err && err.killed) {
      callback(err, stdout, `Timed out after ${Math.round(timeoutMs / 1000)}s and was stopped.`);
      return;
    }
    callback(err, stdout, stderr);
  });
}

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
  const pathname = req.url.split('?')[0];
  const urlPath = pathname === '/' ? '/public/index.html' : pathname;
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

// POST /parts/:id is the trust boundary for JSON updates — validate here so
// every caller inherits the check, store.update() stays a dumb writer.
//
// Do NOT reuse numberOrNull/speciesOrNull/rotationsOrUndefined above: they're
// built for multipart *strings* and misbehave on real JSON values.
// numberOrNull(null) returns 0 (Number(null) === 0), which would silently
// turn a deliberate "clear this value" into a stored 0. speciesOrNull calls
// .split() on its argument, which throws on an actual array.
// Both gate matching (see GATING_ATTRIBUTES in src/skins/similarity.js), so
// both are required exactly where matching is created -- the three routes
// that produce a scale signature -- and nowhere else. An outline-only hide
// needs neither: nesting does not care how a hide was finished.
const MATCHING_REQUIRED_FIELDS = ['cut', 'finish'];

// Names what is actually missing rather than a fixed field, so the operator
// is not told to supply something they already gave.
function matchingFieldsError(missing) {
  const verb = missing.length === 1 ? 'is' : 'are';
  return `${missing.join(' and ')} ${verb} required when measuring a hide for matching.`;
}

// POST /skins/:id is the trust boundary for hide edits, same split as
// validateDieUpdate below: validate here, store.update() stays a dumb writer.
//
// Unknown keys are REJECTED rather than ignored, which is a deliberate
// divergence from validateDieUpdate. This route exists so a mislabelled hide
// can be corrected, so a typo that reports success while changing nothing is
// the precise failure it must not have -- and the same rule gives a measured
// field an honest refusal instead of silence.
const EDITABLE_HIDE_FIELDS = ['label', 'species', 'cut', 'finish', 'thicknessMm'];

function validateHideUpdate(payload, existing) {
  const result = {};

  const unknown = Object.keys(payload).filter((k) => !EDITABLE_HIDE_FIELDS.includes(k));
  if (unknown.length > 0) {
    return {
      error:
        `Cannot set ${unknown.join(', ')}. Editable: ${EDITABLE_HIDE_FIELDS.join(', ')}. ` +
        'A hide\'s outline and colour come from re-digitizing it, and its scale ' +
        'measurement from measuring it -- neither can be typed in.',
    };
  }

  // Required, and not clearable: a hide with no name or no species cannot be
  // found or matched. Both are required at creation for the same reason.
  for (const field of ['label', 'species']) {
    if (field in payload) {
      const value = payload[field];
      if (typeof value !== 'string' || value.trim() === '') {
        return { error: `${field} must be a non-empty string.` };
      }
      result[field] = value.trim();
    }
  }

  if ('finish' in payload) {
    const { finish } = payload;
    if (finish !== null && typeof finish !== 'string') {
      return { error: 'finish must be a string or null.' };
    }
    const trimmed = finish === null ? null : finish.trim();
    result.finish = trimmed === '' ? null : trimmed;
  }

  if ('cut' in payload) {
    const { cut } = payload;
    if (cut !== null && typeof cut !== 'string') {
      return { error: 'cut must be a string or null.' };
    }
    const trimmed = cut === null ? null : cut.trim();
    const cleared = trimmed === '' ? null : trimmed;

    // Every hide carrying a scale signature has a cut -- all three capture
    // routes enforce it. Without this check, editing is a back door around
    // that rule, and matching would silently start flagging pairs as
    // unverifiable again. Re-measuring is the way to change a matchable
    // hide's cut; clearing it outright is not offered.
    if (cleared === null && existing.dominantWavelengthMm != null) {
      return {
        error:
          'This hide is measured for matching, so it must keep a cut. ' +
          'Choose a different cut, or re-measure the hide to change it.',
      };
    }
    result.cut = cleared;
  }

  if ('thicknessMm' in payload) {
    const { thicknessMm } = payload;
    if (thicknessMm === null) {
      result.thicknessMm = null;
    } else if (typeof thicknessMm !== 'number' || !Number.isFinite(thicknessMm) || thicknessMm <= 0) {
      return { error: 'thicknessMm must be a positive number or null.' };
    } else {
      result.thicknessMm = thicknessMm;
    }
  }

  return { value: result };
}

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

  for (const field of [
    'valuePerPiece',
    'thicknessMinMm',
    'thicknessMaxMm',
    'dieClearanceMm',
  ]) {
    if (field in payload) {
      const value = payload[field];
      if (value !== null && !(typeof value === 'number' && Number.isFinite(value))) {
        return { error: `${field} must be a number or null.` };
      }
      // All four are magnitudes — a price, two material thicknesses, and a
      // die clearance — so none can meaningfully be negative. The range
      // check further down only catches an INVERTED range (min > max), so
      // without this a lone negative thickness would be accepted and stored.
      if (value !== null && value < 0) {
        return { error: `${field} must not be negative.` };
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

  execPython(args, (err, stdout, stderr) => {
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
    const finish = getField('finish') || null;
    const photoExt = path.extname(photo.originalFilename || '') || '.jpg';

    if (captureType === 'outline') {
      const thicknessMmRaw = getField('thicknessMm');
      if (!thicknessMmRaw) {
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 400, { error: 'thicknessMm is required.' });
        return;
      }

      // Validated before digitize.py is spawned rather than inside its
      // callback: a missing cut is knowable up front, so failing early avoids
      // a Python round trip and a second cleanup path.
      const cut = getField('cut') || null;
      if (getField('captureForMatching') === 'true') {
        const missing = MATCHING_REQUIRED_FIELDS.filter((field) => !getField(field));
        if (missing.length > 0) {
          fs.unlink(photo.filepath, () => {});
          sendJSON(res, 400, { error: matchingFieldsError(missing) });
          return;
        }
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

      execPython(args, (err, stdout, stderr) => {
        if (err) {
          fs.unlink(photo.filepath, () => {});
          sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
          return;
        }
        const { polygon, colourL, colourA, colourB } = JSON.parse(stdout);

        const save = (signature, warning) => {
          const record = store.create({
            label,
            species,
            cut,
            thicknessMm: Number(thicknessMmRaw),
            outlinePolygon: polygon,
            colourL,
            colourA,
            colourB,
            finish,
            dominantWavelengthMm: signature?.dominantWavelengthMm,
            radialSpectrum: signature?.radialSpectrum,
            photoPath: photo.filepath,
            photoExt,
          });
          fs.unlink(photo.filepath, () => {});
          // The warning rides on the response only, never onto the record --
          // it describes this capture attempt, not the hide.
          sendJSON(res, 200, warning ? { ...record, warning } : record);
        };

        // A hide is matchable exactly when it carries a scale signature, so
        // the operator's "also measure this for matching" toggle has to
        // actually produce one -- a stored flag on its own would mark hides
        // that rankMatches() then filters straight back out.
        //
        // The patch is its own region, not the outline's: the outline region
        // answers "where is the hide", while skin_signature.py needs a clean
        // stretch of scales, which it centre-crops to a square and runs an
        // FFT over.
        const matchRoiFields = ['matchRoiX', 'matchRoiY', 'matchRoiWidth', 'matchRoiHeight'];
        if (getField('captureForMatching') !== 'true') {
          save(null, null);
          return;
        }
        if (!matchRoiFields.every((field) => getField(field))) {
          save(null, 'Hide saved. No scale patch was marked, so it will not appear in matching.');
          return;
        }

        const signatureArgs = [
          SKIN_SIGNATURE_SCRIPT,
          photo.filepath,
          ...matchRoiFields.map(getField),
          getField('p1x'),
          getField('p1y'),
          getField('p2x'),
          getField('p2y'),
          getField('realDistanceMm'),
        ];
        execPython(signatureArgs, (signatureErr, signatureStdout, signatureStderr) => {
          if (signatureErr) {
            // Losing the whole hide over an optional second measurement would
            // throw away the calibration and outline work with it. Save it,
            // say what failed, and let a better patch be marked later.
            save(
              null,
              'Hide saved, but the matching measurement failed, so it will not appear in ' +
                `matching: ${signatureStderr.trim() || 'could not measure the scale pattern.'}`
            );
            return;
          }
          save(JSON.parse(signatureStdout), null);
        });
      });
      return;
    }

    if (captureType !== 'signature') {
      fs.unlink(photo.filepath, () => {});
      sendJSON(res, 400, { error: 'captureType must be "signature" or "outline".' });
      return;
    }

    // Everything this path creates is a matchable hide, so a cut is never
    // optional here -- see the cut spec's "required wherever a signature is
    // produced".
    const cut = getField('cut');
    const missingForMatching = MATCHING_REQUIRED_FIELDS.filter((field) => !getField(field));
    if (missingForMatching.length > 0) {
      fs.unlink(photo.filepath, () => {});
      sendJSON(res, 400, { error: matchingFieldsError(missingForMatching) });
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

    execPython(args, (err, stdout, stderr) => {
      if (err) {
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 422, { error: stderr.trim() || 'Signature computation failed.' });
        return;
      }

      const { dominantWavelengthMm, radialSpectrum } = JSON.parse(stdout);

      // Same ROI already collected for the scale signature -- colour needs
      // no calibration, just the region. Matching by scale alone ranks on
      // the one attribute the operator didn't name; see the products spec.
      const colourArgs = [
        COLOUR_SAMPLE_SCRIPT,
        photo.filepath,
        getField('roiX'),
        getField('roiY'),
        getField('roiWidth'),
        getField('roiHeight'),
      ];
      execPython(colourArgs, (colourErr, colourStdout) => {
        const colour = colourErr ? {} : JSON.parse(colourStdout);
        const record = store.create({
          label,
          species,
          cut,
          dominantWavelengthMm,
          radialSpectrum,
          colourL: colour.l,
          colourA: colour.a,
          colourB: colour.b,
          finish,
          photoPath: photo.filepath,
          photoExt,
        });
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 200, record);
      });
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

  // Same digitize.py pipeline as the initial outline capture (captureType
  // 'outline'), but overwrites the existing record instead of creating a
  // new one -- see store.redigitize() for why that's the right operation
  // once real leather has actually been cut.
  async function handleRedigitizeSkin(req, res, id) {
    const existing = store.list().find((s) => s.id === id);
    if (!existing) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }

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
    const photoExt = path.extname(photo.originalFilename || '') || '.jpg';

    execPython(args, (err, stdout, stderr) => {
      if (err) {
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
        return;
      }
      const { polygon, colourL, colourA, colourB } = JSON.parse(stdout);
      const record = store.redigitize(id, {
        outlinePolygon: polygon,
        colourL,
        colourA,
        colourB,
        photoPath: photo.filepath,
        photoExt,
      });
      fs.unlink(photo.filepath, () => {});
      sendJSON(res, 200, record);
    });
  }

  // Makes a hide already in the library matchable, without re-adding it.
  //
  // Measures the photo the hide ALREADY has rather than taking a new upload:
  // it is the same hide, and re-shooting it is redigitize's job. What can't
  // be reused is the calibration -- it is spent at capture time converting
  // the outline to millimetres and never stored -- so the operator marks two
  // points again here.
  async function handleUpdateSkin(req, res, id) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }

    const existing = store.list().find((s) => s.id === id);
    if (!existing) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }

    const { error, value } = validateHideUpdate(payload, existing);
    if (error) {
      sendJSON(res, 400, { error });
      return;
    }

    const updated = store.update(id, value);
    if (!updated) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }
    sendJSON(res, 200, updated);
  }

  async function handleMeasureSkinSignature(req, res, id) {
    const existing = store.list().find((s) => s.id === id);
    if (!existing) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }
    const storedPhoto = store.photoPath(id);
    if (!storedPhoto || !fs.existsSync(storedPhoto)) {
      sendJSON(res, 422, { error: 'This hide has no stored photo to measure.' });
      return;
    }

    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse request.' });
      return;
    }
    cleanupFiles(files);

    const getField = (name) => fields[name] && fields[name][0];
    const required = [
      'roiX', 'roiY', 'roiWidth', 'roiHeight',
      'p1x', 'p1y', 'p2x', 'p2y', 'realDistanceMm',
    ];
    if (required.some((field) => getField(field) === undefined)) {
      sendJSON(res, 400, { error: 'A calibration and a scale patch are both required.' });
      return;
    }

    // Required to become matchable, but asked for only once: a hide that
    // already knows its cut is not re-interrogated. Naming a different one
    // overwrites, which is currently the only way to correct a mislabel.
    // Supplied wins, then whatever the hide already knows. A hide that can
    // already answer is not re-interrogated; naming a different value
    // overwrites, which is currently the only way to correct a mislabel here.
    const cut = getField('cut') || existing.cut || null;
    const finish = getField('finish') || existing.finish || null;
    const missing = MATCHING_REQUIRED_FIELDS.filter((field) => !({ cut, finish })[field]);
    if (missing.length > 0) {
      sendJSON(res, 400, { error: matchingFieldsError(missing) });
      return;
    }

    const args = [SKIN_SIGNATURE_SCRIPT, storedPhoto, ...required.map(getField)];
    execPython(args, (err, stdout, stderr) => {
      if (err) {
        // Nothing to lose here, unlike the create path -- the hide already
        // exists and is untouched, so a failed measurement is just an error.
        sendJSON(res, 422, {
          error: stderr.trim() || 'Could not measure the scale pattern.',
        });
        return;
      }
      const { dominantWavelengthMm, radialSpectrum } = JSON.parse(stdout);
      sendJSON(res, 200, store.setSignature(id, { dominantWavelengthMm, radialSpectrum, cut, finish }));
    });
  }

  return {
    handleCreateSkin,
    handleListSkins,
    handleMatchSkins,
    handleDeleteSkin,
    handleSkinPhoto,
    handleRedigitizeSkin,
    handleMeasureSkinSignature,
    handleUpdateSkin,
  };
}

function createPartsRoutes(dataDir) {
  const store = createPartStore(dataDir);

  async function handleCreatePart(req, res) {
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

    // The same magnitude rule validateDieUpdate applies. Without it the
    // create path is the back door: numberOrNull passes -5 straight through,
    // so a component could be created with a negative thickness or price
    // that the update route would refuse to set. Only numbers are checked,
    // which leaves allowedRotations (an array, where negative degrees are
    // legitimate) alone.
    const negativeField = Object.entries(metadata).find(
      ([, value]) => typeof value === 'number' && value < 0
    );
    if (negativeField) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: `${negativeField[0]} must not be negative.` });
      return;
    }

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
      sendJSON(res, 400, { error: 'roiX, roiY, roiWidth, and roiHeight are required when adding a part from a photo.' });
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
    execPython(args, (err, stdout, stderr) => {
      fs.unlink(photoFile.filepath, () => {});
      if (err) {
        sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
        return;
      }
      const { polygon } = JSON.parse(stdout);
      sendJSON(res, 200, store.create({ name, polygon, ...metadata }));
    });
  }

  // What is in this pattern file? Answered without saving anything, because
  // the operator has to settle two things a file cannot state.
  //
  // First, scale: a file that gives only a coordinate box is genuinely
  // ambiguous. The real card-wallet pattern that drove this reads as 217mm
  // across taken as millimetres and 76mm taken as points — near A4 against a
  // card wallet. Guessing means cutting a pattern at triple size.
  //
  // Second, what the interior rings ARE: a stitch guide that must never be
  // cut is geometrically identical to a hole that must be. Only the operator
  // knows which.
  async function handlePreviewPattern(req, res) {
    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse upload.' });
      return;
    }

    const svgFile = files.svg && files.svg[0];
    if (!svgFile) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: 'No svg file uploaded.' });
      return;
    }

    const svgContent = fs.readFileSync(svgFile.filepath, 'utf8');
    cleanupFiles(files);

    try {
      const units = unitOptions(svgContent);
      // Parsed once per candidate unit so the operator sees real piece sizes
      // rather than a scale factor they would have to apply themselves.
      const pieces = parseSVGComponents(svgContent, {
        unit: units.stated ? 'mm' : 'mm',
      }).map((piece, index) => ({
        index,
        points: piece.polygon.length,
        interiorCount: piece.interiorPaths.length,
      }));
      sendJSON(res, 200, { statesItsOwnSize: units.stated, units: units.options, pieces });
    } catch (err) {
      sendJSON(res, 422, { error: err.message });
    }
  }

  // Import every piece in the file as its own component.
  async function handleImportPattern(req, res) {
    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse upload.' });
      return;
    }

    const getField = (name) => fields[name] && fields[name][0];
    const svgFile = files.svg && files.svg[0];
    if (!svgFile) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: 'No svg file uploaded.' });
      return;
    }

    const svgContent = fs.readFileSync(svgFile.filepath, 'utf8');
    cleanupFiles(files);

    const baseName = getField('name');
    if (!baseName) {
      sendJSON(res, 400, { error: 'A name is required.' });
      return;
    }

    const unit = getField('unit') || 'mm';
    // 'cut' or 'mark'. The file cannot say, so it is asked.
    const interiorKind = getField('interiorKind') === 'mark' ? 'mark' : 'cut';

    let pieces;
    try {
      pieces = parseSVGComponents(svgContent, { unit, interiorKind });
    } catch (err) {
      sendJSON(res, 422, { error: err.message });
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
    // Same magnitude rule the create path applies: numberOrNull passes a
    // negative straight through, and the update route would refuse to set
    // what this would otherwise create.
    const negativeField = Object.entries(metadata).find(
      ([, value]) => typeof value === 'number' && value < 0
    );
    if (negativeField) {
      sendJSON(res, 400, { error: `${negativeField[0]} must not be negative.` });
      return;
    }

    // One file, several components. Numbered only when there is more than
    // one, so a single-piece pattern keeps the name the operator typed.
    const created = pieces.map((piece, index) =>
      store.create({
        name: pieces.length > 1 ? `${baseName} ${index + 1}` : baseName,
        polygon: piece.polygon,
        interiorPaths: piece.interiorPaths,
        ...metadata,
      })
    );
    sendJSON(res, 200, created);
  }

  function handleListParts(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleDeletePart(req, res, id) {
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Part not found.' });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  async function handleUpdatePart(req, res, id) {
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
      sendJSON(res, 404, { error: 'Part not found.' });
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
      sendJSON(res, 404, { error: 'Part not found.' });
      return;
    }
    sendJSON(res, 200, updated);
  }

  return {
    handleCreatePart,
    handlePreviewPattern,
    handleImportPattern,
    handleListParts,
    handleDeletePart,
    handleUpdatePart,
  };
}

function createCalibrationsRoutes(dataDir) {
  const store = createCalibrationStore(dataDir);

  async function handleCreateCalibration(req, res) {
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

    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      sendJSON(res, 400, { error: 'name is required.' });
      return;
    }

    const numericFields = ['p1x', 'p1y', 'p2x', 'p2y', 'realDistanceMm', 'photoWidth', 'photoHeight'];
    for (const field of numericFields) {
      if (typeof payload[field] !== 'number' || !Number.isFinite(payload[field])) {
        sendJSON(res, 400, { error: `${field} must be a finite number.` });
        return;
      }
    }
    if (payload.realDistanceMm <= 0) {
      sendJSON(res, 400, { error: 'realDistanceMm must be positive.' });
      return;
    }
    if (!Number.isInteger(payload.photoWidth) || payload.photoWidth <= 0 ||
        !Number.isInteger(payload.photoHeight) || payload.photoHeight <= 0) {
      sendJSON(res, 400, { error: 'photoWidth and photoHeight must be positive integers.' });
      return;
    }

    sendJSON(res, 200, store.create({
      name,
      p1x: payload.p1x,
      p1y: payload.p1y,
      p2x: payload.p2x,
      p2y: payload.p2y,
      realDistanceMm: payload.realDistanceMm,
      photoWidth: payload.photoWidth,
      photoHeight: payload.photoHeight,
    }));
  }

  function handleListCalibrations(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleDeleteCalibration(req, res, id) {
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Calibration not found.' });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  return { handleCreateCalibration, handleListCalibrations, handleDeleteCalibration };
}

function createProductsRoutes(dataDir, partsDataDir) {
  const store = createProductStore(dataDir);
  const partStore = createPartStore(partsDataDir);

  // The trust boundary for a product's part list: every partId must name a
  // real part, and every quantity a positive integer, or a product could
  // silently ask the search to place a part that no longer exists.
  function validateParts(parts) {
    if (!Array.isArray(parts) || parts.length === 0) {
      return { error: 'parts must be a non-empty array.' };
    }
    const knownIds = new Set(partStore.list().map((p) => p.id));
    for (const part of parts) {
      if (!part || typeof part.partId !== 'string' || !knownIds.has(part.partId)) {
        return { error: `partId ${JSON.stringify(part?.partId)} does not name an existing part.` };
      }
      if (!Number.isInteger(part.quantity) || part.quantity <= 0) {
        return { error: 'quantity must be a positive integer.' };
      }
      if ('mustMatch' in part && typeof part.mustMatch !== 'boolean') {
        return { error: 'mustMatch must be a boolean.' };
      }
    }
    return { value: parts };
  }

  async function handleCreateProduct(req, res) {
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

    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      sendJSON(res, 400, { error: 'name is required.' });
      return;
    }

    const partsResult = validateParts(payload.parts);
    if (partsResult.error) {
      sendJSON(res, 400, { error: partsResult.error });
      return;
    }

    // How many of this product are actually wanted -- 0 (the default) means
    // no order to fill, and evaluateProductCandidate's demandSatisfied is
    // just the count made, uncapped by any target.
    let demand = 0;
    if ('demand' in payload) {
      const { demand: demandRaw } = payload;
      if (!(typeof demandRaw === 'number' && Number.isFinite(demandRaw)) || demandRaw < 0) {
        sendJSON(res, 400, { error: 'demand must be a finite number >= 0.' });
        return;
      }
      demand = demandRaw;
    }

    sendJSON(res, 200, store.create({ name, parts: partsResult.value, demand }));
  }

  function handleListProducts(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleDeleteProduct(req, res, id) {
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Product not found.' });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  return { handleCreateProduct, handleListProducts, handleDeleteProduct };
}

function createSessionsRoutes(dataDir, partsDataDir, skinsDataDir) {
  const store = createSessionStore(dataDir);
  const partStore = createPartStore(partsDataDir);
  const skinStore = createStore(skinsDataDir);

  // Rotation and translation preserve area, so the raw part polygon is
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

    const { partId, x, y, rotation } = payload;
    const part = partStore.list().find((d) => d.id === partId);
    if (!part) {
      sendJSON(res, 404, { error: 'Part not found.' });
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
      partPolygon: part.polygon,
      referencePlacement: { x, y, rotation },
      occupied,
    };

    const child = execPython([BLOTCH_MATCH_SCRIPT], { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
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
        partId,
        partName: part.name,
        polygon: part.polygon,
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
  partsDataDir = path.join(__dirname, 'data', 'parts'),
  sessionsDataDir = path.join(__dirname, 'data', 'sessions'),
  productsDataDir = path.join(__dirname, 'data', 'products'),
  calibrationsDataDir = path.join(__dirname, 'data', 'calibrations'),
} = {}) {
  const skins = createSkinsRoutes(dataDir);
  const parts = createPartsRoutes(partsDataDir);
  const sessions = createSessionsRoutes(sessionsDataDir, partsDataDir, dataDir);
  const products = createProductsRoutes(productsDataDir, partsDataDir);
  const calibrations = createCalibrationsRoutes(calibrationsDataDir);

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
    const skinUpdateMatch = req.method === 'POST' && req.url.match(/^\/skins\/([^/]+)$/);
    if (skinUpdateMatch) {
      skins.handleUpdateSkin(req, res, skinUpdateMatch[1]);
      return;
    }

    const skinDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/skins\/([^/]+)$/);
    if (skinDeleteMatch) {
      skins.handleDeleteSkin(req, res, skinDeleteMatch[1]);
      return;
    }
    const redigitizeMatch = req.method === 'POST' && req.url.match(/^\/skins\/([^/]+)\/redigitize$/);
    if (redigitizeMatch) {
      skins.handleRedigitizeSkin(req, res, redigitizeMatch[1]);
      return;
    }
    const signatureMatch = req.method === 'POST' && req.url.match(/^\/skins\/([^/]+)\/signature$/);
    if (signatureMatch) {
      skins.handleMeasureSkinSignature(req, res, signatureMatch[1]);
      return;
    }
    if (req.method === 'POST' && req.url === '/parts') {
      parts.handleCreatePart(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/patterns/preview') {
      parts.handlePreviewPattern(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/patterns') {
      parts.handleImportPattern(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/parts') {
      parts.handleListParts(req, res);
      return;
    }
    const partUpdateMatch = req.method === 'POST' && req.url.match(/^\/parts\/([^/]+)$/);
    if (partUpdateMatch) {
      parts.handleUpdatePart(req, res, partUpdateMatch[1]);
      return;
    }
    const partDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/parts\/([^/]+)$/);
    if (partDeleteMatch) {
      parts.handleDeletePart(req, res, partDeleteMatch[1]);
      return;
    }
    if (req.method === 'POST' && req.url === '/products') {
      products.handleCreateProduct(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/products') {
      products.handleListProducts(req, res);
      return;
    }
    const productDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/products\/([^/]+)$/);
    if (productDeleteMatch) {
      products.handleDeleteProduct(req, res, productDeleteMatch[1]);
      return;
    }
    if (req.method === 'POST' && req.url === '/calibrations') {
      calibrations.handleCreateCalibration(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/calibrations') {
      calibrations.handleListCalibrations(req, res);
      return;
    }
    const calibrationDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/calibrations\/([^/]+)$/);
    if (calibrationDeleteMatch) {
      calibrations.handleDeleteCalibration(req, res, calibrationDeleteMatch[1]);
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
