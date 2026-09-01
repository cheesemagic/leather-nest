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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const PYTHON = path.join(__dirname, 'venv', 'bin', 'python3');
const DIGITIZE_SCRIPT = path.join(__dirname, 'scripts', 'digitize.py');
const SKIN_SIGNATURE_SCRIPT = path.join(__dirname, 'scripts', 'skin_signature.py');

const MIME_TYPES = {
  '.html': 'text/html',
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
      const photoExt = path.extname(photo.originalFilename || '') || '.jpg';
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

    if (!name || (!svgFile && !photoFile)) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: 'name and either an svg file or a photo with calibration are required.' });
      return;
    }

    if (svgFile) {
      const svgContent = fs.readFileSync(svgFile.filepath, 'utf8');
      fs.unlink(svgFile.filepath, () => {});
      try {
        const polygon = parseSVGPolygon(svgContent);
        sendJSON(res, 200, store.create({ name, polygon }));
      } catch (err) {
        sendJSON(res, 422, { error: err.message });
      }
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
      sendJSON(res, 200, store.create({ name, polygon }));
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

  return { handleCreateDie, handleListDies, handleDeleteDie };
}

export function createServer({
  dataDir = path.join(__dirname, 'data', 'skins'),
  diesDataDir = path.join(__dirname, 'data', 'dies'),
} = {}) {
  const skins = createSkinsRoutes(dataDir);
  const dies = createDiesRoutes(diesDataDir);

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
    const dieDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/dies\/([^/]+)$/);
    if (dieDeleteMatch) {
      dies.handleDeleteDie(req, res, dieDeleteMatch[1]);
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
