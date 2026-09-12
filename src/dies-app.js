import { attachCalibration } from './calibration-ui.js';
import { attachRegionSelect } from './region-select-ui.js';
import { boundingBox, polygonToSVGPoints } from './nesting/geometry.js';

const nameInput = document.getElementById('name-input');
const modeRadios = document.querySelectorAll('input[name="add-mode"]');
const svgMode = document.getElementById('svg-mode');
const photoMode = document.getElementById('photo-mode');
const dimensionsMode = document.getElementById('dimensions-mode');
const svgInput = document.getElementById('svg-input');
const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const regionContainer = document.getElementById('region-container');
const submitButton = document.getElementById('submit-die');
const addStatus = document.getElementById('add-status');
const summaryEl = document.getElementById('components-summary');
const gridEl = document.getElementById('component-grid');
const searchInput = document.getElementById('component-search');
const familyTagsEl = document.getElementById('family-tags');
const addPanel = document.getElementById('add-panel');

let components = [];
let selectedFamily = null;

let selectedPhoto = null;
let calibration = null;
let region = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

for (const radio of modeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    svgMode.style.display = radio.value === 'svg' ? 'block' : 'none';
    photoMode.style.display = radio.value === 'photo' ? 'block' : 'none';
    dimensionsMode.style.display = radio.value === 'dimensions' ? 'block' : 'none';
  });
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
    attachRegionSelect(regionContainer, objectUrl, (regionResult) => {
      region = regionResult;
    });
  });
});

submitButton.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) {
    addStatus.textContent = 'Name is required.';
    return;
  }

  const mode = document.querySelector('input[name="add-mode"]:checked').value;
  const formData = new FormData();
  formData.append('name', name);

  const metadata = {
    productFamily: document.getElementById('family-input').value.trim(),
    valuePerPiece: document.getElementById('value-input').value,
    demand: document.getElementById('demand-input').value,
    allowedSpecies: document.getElementById('species-input').value.trim(),
    thicknessMinMm: document.getElementById('thickness-min-input').value,
    thicknessMaxMm: document.getElementById('thickness-max-input').value,
    allowedRotations: document.getElementById('rotations-input').value.trim(),
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== '') formData.append(key, value);
  }

  if (mode === 'svg') {
    const file = svgInput.files[0];
    if (!file) {
      addStatus.textContent = 'Choose an SVG file.';
      return;
    }
    formData.append('svg', file);
  } else if (mode === 'photo') {
    if (!selectedPhoto || !calibration || !region) {
      addStatus.textContent = 'Upload a photo, complete calibration, and select the die region first.';
      return;
    }
    formData.append('photo', selectedPhoto);
    formData.append('p1x', calibration.p1x);
    formData.append('p1y', calibration.p1y);
    formData.append('p2x', calibration.p2x);
    formData.append('p2y', calibration.p2y);
    formData.append('realDistanceMm', calibration.realDistanceMm);
    formData.append('roiX', region.roiX);
    formData.append('roiY', region.roiY);
    formData.append('roiWidth', region.roiWidth);
    formData.append('roiHeight', region.roiHeight);
  } else if (mode === 'dimensions') {
    const widthMm = document.getElementById('width-input').value;
    const heightMm = document.getElementById('height-input').value;
    if (!widthMm || !heightMm) {
      addStatus.textContent = 'Enter both a width and a height.';
      return;
    }
    formData.append('widthMm', widthMm);
    formData.append('heightMm', heightMm);
  }

  addStatus.textContent = 'Adding…';

  try {
    const response = await fetch('/dies', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    addStatus.textContent = `Added "${body.name}".`;
    nameInput.value = '';
    svgInput.value = '';
    photoInput.value = '';
    calibrationContainer.innerHTML = '';
    regionContainer.innerHTML = '';
    selectedPhoto = null;
    calibration = null;
    region = null;
    document.getElementById('width-input').value = '';
    document.getElementById('height-input').value = '';
    document.getElementById('family-input').value = '';
    document.getElementById('value-input').value = '';
    document.getElementById('demand-input').value = '';
    document.getElementById('species-input').value = '';
    document.getElementById('thickness-min-input').value = '';
    document.getElementById('thickness-max-input').value = '';
    document.getElementById('rotations-input').value = '';
    loadDies();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

function familyOf(component) {
  return (component.productFamily || '').trim().toLowerCase();
}

function sizeLabel(component) {
  const b = boundingBox(component.polygon);
  return `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} mm`;
}

function shapeSVG(component) {
  const bounds = boundingBox(component.polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) return '';
  return `
    <svg width="80" height="${Math.max(1, (80 * height) / width)}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
      <polygon points="${polygonToSVGPoints(component.polygon)}" stroke="var(--color-accent)" stroke-width="${width / 80}" fill="none" />
    </svg>`;
}

function matchesFilters(component, query, family) {
  if (family && familyOf(component) !== family) return false;
  if (!query) return true;
  return `${component.name} ${component.productFamily || ''} ${component.id}`.toLowerCase().includes(query);
}

function renderFamilyTags() {
  const families = [...new Set(components.map(familyOf).filter(Boolean))].sort();
  familyTagsEl.innerHTML = families
    .map(
      (f) =>
        `<button type="button" class="tag ${f === selectedFamily ? 'tag-accent' : 'tag-neutral'}" aria-pressed="${f === selectedFamily}" data-family="${escapeHtml(f)}">${escapeHtml(f)}</button>`
    )
    .join('');
}

function renderGrid() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = components.filter((c) => matchesFilters(c, query, selectedFamily));

  summaryEl.textContent = `${visible.length} component${visible.length === 1 ? '' : 's'}`;

  gridEl.innerHTML = visible
    .map(
      (component) => `
    <div class="card component-card elev-sm">
      <div class="shape">${shapeSVG(component)}</div>
      <div class="card-title">
        <span>${escapeHtml(component.name)}</span>
        ${component.productFamily ? `<span class="tag tag-neutral">${escapeHtml(component.productFamily)}</span>` : ''}
      </div>
      <p class="card-body">
        ${sizeLabel(component)}${component.valuePerPiece != null ? ` · $${component.valuePerPiece.toFixed(2)} each` : ''}
      </p>
      <div class="card-meta">${component.demand ? `demand ${component.demand}` : 'no current demand'}</div>
      <div class="component-actions">
        <button type="button" class="btn btn-secondary" data-edit-id="${component.id}">Edit</button>
        <button type="button" class="btn btn-secondary" data-delete-id="${component.id}">Delete</button>
      </div>
    </div>
  `
    )
    .join('');
}

async function loadDies() {
  const response = await fetch('/dies');
  components = await response.json();
  renderFamilyTags();
  renderGrid();
}

familyTagsEl.addEventListener('click', (event) => {
  const family = event.target.dataset.family;
  if (!family) return;
  selectedFamily = selectedFamily === family ? null : family;
  renderFamilyTags();
  renderGrid();
});

searchInput.addEventListener('input', renderGrid);

const editDialog = document.getElementById('edit-dialog');
const editStatus = document.getElementById('edit-status');
let editingId = null;

function openEdit(component) {
  editingId = component.id;
  document.getElementById('edit-name').value = component.name;
  document.getElementById('edit-family').value = component.productFamily || '';
  document.getElementById('edit-value').value = component.valuePerPiece ?? '';
  document.getElementById('edit-demand').value = component.demand ?? 0;
  editStatus.textContent = '';
  editDialog.hidden = false;
}

document.getElementById('cancel-edit').addEventListener('click', () => {
  editDialog.hidden = true;
  editingId = null;
});

document.getElementById('save-edit').addEventListener('click', async () => {
  if (!editingId) return;
  const value = document.getElementById('edit-value').value;
  const demand = document.getElementById('edit-demand').value;
  editStatus.textContent = 'Saving…';
  try {
    const response = await fetch(`/dies/${editingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('edit-name').value.trim(),
        productFamily: document.getElementById('edit-family').value.trim() || null,
        valuePerPiece: value === '' ? null : Number(value),
        demand: demand === '' ? 0 : Number(demand),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      editStatus.textContent = `Error: ${body.error}`;
      return;
    }
    editDialog.hidden = true;
    editingId = null;
    await loadDies();
  } catch {
    editStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

gridEl.addEventListener('click', async (event) => {
  const editId = event.target.dataset.editId;
  if (editId) {
    const component = components.find((c) => c.id === editId);
    if (component) openEdit(component);
    return;
  }
  const deleteId = event.target.dataset.deleteId;
  if (!deleteId) return;
  await fetch(`/dies/${deleteId}`, { method: 'DELETE' });
  loadDies();
});

document.getElementById('open-add').addEventListener('click', () => {
  addPanel.hidden = false;
});
document.getElementById('cancel-add').addEventListener('click', () => {
  addPanel.hidden = true;
});

loadDies();
