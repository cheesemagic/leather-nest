import { attachCalibration } from './calibration-ui.js';
import { attachRegionSelect } from './region-select-ui.js';
import { boundingBox } from './nesting/geometry.js';

const summaryEl = document.getElementById('hides-summary');
const gridEl = document.getElementById('hide-grid');
const searchInput = document.getElementById('hide-search');
const speciesTagsEl = document.getElementById('species-tags');

const openAddButton = document.getElementById('open-add-hide');
const cancelAddButton = document.getElementById('cancel-add-hide');
const submitButton = document.getElementById('submit-hide');
const dialog = document.getElementById('add-hide-dialog');
const labelInput = document.getElementById('hide-label');
const speciesInput = document.getElementById('hide-species');
const thicknessInput = document.getElementById('hide-thickness');
const photoInput = document.getElementById('hide-photo');
const calibrationContainer = document.getElementById('hide-calibration-container');
const regionContainer = document.getElementById('hide-region-container');
const addStatus = document.getElementById('add-hide-status');

let hides = [];
let selectedSpecies = null;
let selectedPhoto = null;
let calibration = null;
let region = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hideSizeLabel(hide) {
  if (!hide.outlinePolygon) return '—';
  const b = boundingBox(hide.outlinePolygon);
  const width = Math.round(b.maxX - b.minX);
  const height = Math.round(b.maxY - b.minY);
  return `${width} × ${height} mm`;
}

function hideFootprintAreaMm2(hide) {
  if (!hide.outlinePolygon) return 0;
  const b = boundingBox(hide.outlinePolygon);
  return (b.maxX - b.minX) * (b.maxY - b.minY);
}

function resetAddForm() {
  labelInput.value = '';
  speciesInput.value = '';
  thicknessInput.value = '';
  photoInput.value = '';
  calibrationContainer.innerHTML = '';
  regionContainer.innerHTML = '';
  addStatus.textContent = '';
  selectedPhoto = null;
  calibration = null;
  region = null;
}

openAddButton.addEventListener('click', () => {
  dialog.hidden = false;
});

cancelAddButton.addEventListener('click', () => {
  dialog.hidden = true;
  resetAddForm();
});

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
  const label = labelInput.value.trim();
  const species = speciesInput.value.trim();
  const thicknessMm = thicknessInput.value;

  if (!label || !species || !thicknessMm) {
    addStatus.textContent = 'Name, species, and thickness are required.';
    return;
  }
  if (!selectedPhoto || !calibration) {
    addStatus.textContent = 'Upload a photo and complete calibration first.';
    return;
  }

  const formData = new FormData();
  formData.append('captureType', 'outline');
  formData.append('label', label);
  formData.append('species', species);
  formData.append('thicknessMm', thicknessMm);
  formData.append('photo', selectedPhoto);
  formData.append('p1x', calibration.p1x);
  formData.append('p1y', calibration.p1y);
  formData.append('p2x', calibration.p2x);
  formData.append('p2y', calibration.p2y);
  formData.append('realDistanceMm', calibration.realDistanceMm);
  if (region) {
    formData.append('roiX', region.roiX);
    formData.append('roiY', region.roiY);
    formData.append('roiWidth', region.roiWidth);
    formData.append('roiHeight', region.roiHeight);
  }

  addStatus.textContent = 'Adding…';

  try {
    const response = await fetch('/skins', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    dialog.hidden = true;
    resetAddForm();
    await loadHides();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

function matchesFilters(hide, query, species) {
  if (species && hide.species.trim().toLowerCase() !== species) return false;
  if (!query) return true;
  const haystack = `${hide.label} ${hide.species} ${hide.id}`.toLowerCase();
  return haystack.includes(query);
}

function renderSpeciesTags() {
  const species = [...new Set(hides.map((h) => h.species.trim().toLowerCase()))].sort();
  speciesTagsEl.innerHTML = species
    .map(
      (s) =>
        `<button type="button" class="tag ${s === selectedSpecies ? 'tag-accent' : 'tag-neutral'}" aria-pressed="${s === selectedSpecies}" data-species="${escapeHtml(s)}">${escapeHtml(s)}</button>`,
    )
    .join('');
}

function renderSummary(visible) {
  const totalAreaMm2 = visible.reduce((sum, h) => sum + hideFootprintAreaMm2(h) * ((h.remainingAreaPct ?? 100) / 100), 0);
  const totalAreaCm2 = Math.round(totalAreaMm2 / 100);
  summaryEl.textContent = `${visible.length} hide${visible.length === 1 ? '' : 's'} · ${totalAreaCm2} cm² usable`;
}

function renderGrid() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = hides.filter((h) => matchesFilters(h, query, selectedSpecies));

  renderSummary(visible);

  gridEl.innerHTML = visible
    .map((hide) => {
      const remaining = hide.remainingAreaPct ?? 100;
      const date = new Date(hide.createdAt).toLocaleDateString();
      return `
    <div class="card hide-card elev-sm">
      <img class="washed" src="/skins/${hide.id}/photo" alt="${escapeHtml(hide.label)}" />
      <div class="card-title">
        <span>${escapeHtml(hide.species)}</span>
        <span class="tag tag-outline">${hide.id.slice(0, 8)}</span>
      </div>
      <p class="card-body">${escapeHtml(hide.label)} · ${hideSizeLabel(hide)}${hide.thicknessMm != null ? ` · ${hide.thicknessMm} mm thick` : ''}</p>
      <div class="area-bar"><div class="area-bar-fill" style="width: ${remaining}%"></div></div>
      <div class="card-meta">${remaining}% remaining · captured ${date}</div>
    </div>
  `;
    })
    .join('');
}

async function loadHides() {
  const response = await fetch('/skins');
  hides = await response.json();
  renderSpeciesTags();
  renderGrid();
}

speciesTagsEl.addEventListener('click', (event) => {
  const species = event.target.dataset.species;
  if (!species) return;
  selectedSpecies = selectedSpecies === species ? null : species;
  renderSpeciesTags();
  renderGrid();
});

searchInput.addEventListener('input', renderGrid);

loadHides();
