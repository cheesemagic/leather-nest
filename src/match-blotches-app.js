import { attachCalibration } from './calibration-ui.js';
import { attachRegionSelect } from './region-select-ui.js';
import { boundingBox, polygonToSVGPoints, placedPolygon } from './nesting/geometry.js';

const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const regionContainer = document.getElementById('region-container');
const createStatus = document.getElementById('create-status');
const sessionSection = document.getElementById('session-section');
const partPalette = document.getElementById('part-palette');
const sessionPhoto = document.getElementById('session-photo');
const placementsOverlay = document.getElementById('placements-overlay');
const placementStatus = document.getElementById('placement-status');
const sessionsListEl = document.getElementById('sessions-list');
const hideSelect = document.getElementById('hide-select');

let selectedPhoto = null;
let calibration = null;
let region = null;
let currentSession = null;
let parts = [];

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mmPerPxFor(session) {
  const { p1x, p1y, p2x, p2y, realDistanceMm } = session.calibration;
  const pixelDistance = Math.hypot(p2x - p1x, p2y - p1y);
  return realDistanceMm / pixelDistance;
}

function polygonToPx(polygon, mmPerPx) {
  return polygon.map((p) => ({ x: p.x / mmPerPx, y: p.y / mmPerPx }));
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedPhoto = file;
  calibration = null;
  region = null;
  regionContainer.innerHTML = '';

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, (calibrationResult) => {
    calibration = calibrationResult;
    attachRegionSelect(regionContainer, objectUrl, async (regionResult) => {
      region = regionResult;
      await createSession();
    });
  });
});

async function createSession() {
  createStatus.textContent = 'Creating session…';
  const formData = new FormData();
  formData.append('photo', selectedPhoto);
  for (const [key, value] of Object.entries(calibration)) formData.append(key, String(value));
  for (const [key, value] of Object.entries(region)) formData.append(key, String(value));
  if (hideSelect.value) formData.append('hideId', hideSelect.value);

  try {
    const response = await fetch('/sessions', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      createStatus.textContent = `Error: ${body.error}`;
      return;
    }
    createStatus.textContent = '';
    photoInput.value = '';
    calibrationContainer.innerHTML = '';
    regionContainer.innerHTML = '';
    selectedPhoto = null;
    calibration = null;
    region = null;
    await openSession(body.id);
    loadSessions();
  } catch {
    createStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
}

async function openSession(id) {
  const response = await fetch(`/sessions/${id}`);
  currentSession = await response.json();
  sessionSection.style.display = 'block';
  sessionPhoto.src = `/sessions/${id}/photo`;
  await sessionPhoto.decode().catch(() => {});
  renderPartPalette();
  renderPlacements();
}

function renderPartPalette() {
  partPalette.innerHTML = parts
    .map((part) => {
      const bounds = boundingBox(part.polygon);
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      return `
    <div draggable="true" data-part-id="${part.id}" style="display: inline-block; cursor: grab">
      <svg width="60" height="${(60 * height) / width}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
        <polygon points="${polygonToSVGPoints(part.polygon)}" stroke="#FF0000" stroke-width="${width / 60}" fill="none" />
      </svg>
      <div>${escapeHtml(part.name)}</div>
    </div>
  `;
    })
    .join('');

  for (const el of partPalette.querySelectorAll('[draggable="true"]')) {
    el.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', el.dataset.partId);
    });
  }
}

function renderPlacements() {
  if (!currentSession) return;
  const mmPerPx = mmPerPxFor(currentSession);
  placementsOverlay.setAttribute(
    'viewBox',
    `0 0 ${sessionPhoto.naturalWidth || 1} ${sessionPhoto.naturalHeight || 1}`
  );

  const shapes = currentSession.placements
    .map((placement) => {
      const polygonPx = polygonToPx(placement.polygon, mmPerPx);
      const refPolygon = placedPolygon({ polygon: polygonPx }, placement.reference);
      const refShape = `<polygon points="${polygonToSVGPoints(refPolygon)}" stroke="${placement.color}" stroke-width="3" fill="none" />`;
      if (!placement.match) return refShape;
      const matchPolygon = placedPolygon({ polygon: polygonPx }, placement.match);
      const matchShape = `<polygon points="${polygonToSVGPoints(matchPolygon)}" stroke="${placement.color}" stroke-width="3" fill="none" stroke-dasharray="6,4" />`;
      return refShape + matchShape;
    })
    .join('');
  placementsOverlay.innerHTML = shapes;
}

placementsOverlay.addEventListener('dragover', (event) => event.preventDefault());
placementsOverlay.addEventListener('drop', async (event) => {
  event.preventDefault();
  const partId = event.dataTransfer.getData('text/plain');
  if (!partId || !currentSession) return;

  const rect = sessionPhoto.getBoundingClientRect();
  const displayX = event.clientX - rect.left;
  const displayY = event.clientY - rect.top;
  const x = (displayX / rect.width) * sessionPhoto.naturalWidth;
  const y = (displayY / rect.height) * sessionPhoto.naturalHeight;

  placementStatus.textContent = 'Searching…';
  try {
    const response = await fetch(`/sessions/${currentSession.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId, x, y, rotation: 0 }),
    });
    const body = await response.json();
    if (!response.ok) {
      placementStatus.textContent = `Error: ${body.error}`;
      return;
    }
    currentSession = body;
    const justAdded = currentSession.placements[currentSession.placements.length - 1];
    placementStatus.textContent = justAdded.match
      ? `Match found (score ${justAdded.match.score.toFixed(3)}).`
      : 'No match found: search area has no free, similar region.';
    renderPlacements();
  } catch {
    placementStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

async function loadParts() {
  const response = await fetch('/parts');
  parts = await response.json();
  renderPartPalette();
}

async function loadSessions() {
  const response = await fetch('/sessions');
  const sessions = await response.json();
  sessionsListEl.innerHTML = sessions
    .map(
      (session) => `
    <div>
      <span>${new Date(session.createdAt).toLocaleString()} — ${session.placements.length} placement(s)</span>
      <button type="button" data-open-id="${session.id}">Open</button>
      <button type="button" data-delete-id="${session.id}">Delete</button>
    </div>
  `
    )
    .join('');
}

sessionsListEl.addEventListener('click', async (event) => {
  const openId = event.target.dataset.openId;
  if (openId) {
    await openSession(openId);
    return;
  }
  const deleteId = event.target.dataset.deleteId;
  if (deleteId) {
    await fetch(`/sessions/${deleteId}`, { method: 'DELETE' });
    if (currentSession && currentSession.id === deleteId) {
      currentSession = null;
      sessionSection.style.display = 'none';
    }
    loadSessions();
  }
});

document.getElementById('refresh-sessions').addEventListener('click', loadSessions);

async function loadHideOptions() {
  const hides = await (await fetch('/skins')).json();
  for (const hide of hides) {
    const option = document.createElement('option');
    option.value = hide.id;
    option.textContent = `${hide.label} (${hide.species})`;
    hideSelect.append(option);
  }
}

loadParts();
loadSessions();
loadHideOptions();
