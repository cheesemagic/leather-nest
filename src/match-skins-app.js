import { attachCalibration } from './calibration-ui.js';
import { attachRegionSelect } from './region-select-ui.js';

const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const regionContainer = document.getElementById('region-container');
const addForm = document.getElementById('add-form');
const labelInput = document.getElementById('label-input');
const speciesInput = document.getElementById('species-input');
const submitButton = document.getElementById('submit-skin');
const addStatus = document.getElementById('add-status');
const inventoryEl = document.getElementById('inventory');
const matchesEl = document.getElementById('matches');

let selectedFile = null;
let calibration = null;
let region = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedFile = file;
  calibration = null;
  region = null;
  addForm.style.display = 'none';
  addStatus.textContent = '';
  regionContainer.innerHTML = '';

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, (calibrationResult) => {
    calibration = calibrationResult;
    attachRegionSelect(regionContainer, objectUrl, (regionResult) => {
      region = regionResult;
      addForm.style.display = 'block';
    });
  });
});

submitButton.addEventListener('click', async () => {
  if (!selectedFile || !calibration || !region) return;
  const label = labelInput.value.trim();
  const species = speciesInput.value.trim();
  if (!label || !species) {
    addStatus.textContent = 'Label and species are required.';
    return;
  }

  addStatus.textContent = 'Computing signature…';

  const formData = new FormData();
  formData.append('photo', selectedFile);
  formData.append('label', label);
  formData.append('species', species);
  formData.append('roiX', region.roiX);
  formData.append('roiY', region.roiY);
  formData.append('roiWidth', region.roiWidth);
  formData.append('roiHeight', region.roiHeight);
  formData.append('p1x', calibration.p1x);
  formData.append('p1y', calibration.p1y);
  formData.append('p2x', calibration.p2x);
  formData.append('p2y', calibration.p2y);
  formData.append('realDistanceMm', calibration.realDistanceMm);

  try {
    const response = await fetch('/skins', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    addStatus.textContent = `Added "${body.label}" — ${body.dominantWavelengthMm.toFixed(2)}mm scale.`;
    labelInput.value = '';
    speciesInput.value = '';
    addForm.style.display = 'none';
    loadInventory();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

async function loadInventory() {
  const response = await fetch('/skins');
  const skins = await response.json();
  inventoryEl.innerHTML = skins
    .map(
      (skin) => `
    <div>
      <img src="/skins/${skin.id}/photo" width="80" height="80" style="object-fit: cover" />
      <strong>${escapeHtml(skin.label)}</strong> (${escapeHtml(skin.species)})${skin.dominantWavelengthMm != null ? ` — ${skin.dominantWavelengthMm.toFixed(2)}mm` : ' — outline only'}
      <button type="button" data-delete-id="${skin.id}">Delete</button>
    </div>
  `
    )
    .join('');
}

inventoryEl.addEventListener('click', async (event) => {
  const id = event.target.dataset.deleteId;
  if (!id) return;
  await fetch(`/skins/${id}`, { method: 'DELETE' });
  loadInventory();
});

document.getElementById('refresh-inventory').addEventListener('click', loadInventory);

document.getElementById('refresh-matches').addEventListener('click', async () => {
  const response = await fetch('/skins/matches');
  const groups = await response.json();
  matchesEl.innerHTML = groups
    .map(
      (group) => `
    <h3>${escapeHtml(group.species)}</h3>
    <ul>
      ${group.pairs
        .map(
          (pair) =>
            `<li>${pair.skinAId.slice(0, 8)} &harr; ${pair.skinBId.slice(0, 8)}: ${pair.scaleDifferenceMm.toFixed(2)}mm difference, correlation ${pair.spectrumCorrelation.toFixed(2)}</li>`
        )
        .join('')}
    </ul>
  `
    )
    .join('');
});

loadInventory();
