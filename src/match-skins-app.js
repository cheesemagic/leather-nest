import { attachCalibration } from './calibration-ui.js';
import { attachRegionSelect } from './region-select-ui.js';
import { populateSpeciesSelect } from './skins/species.js';
import { populateCutSelect } from './skins/cuts.js';

const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const regionContainer = document.getElementById('region-container');
const addForm = document.getElementById('add-form');
const labelInput = document.getElementById('label-input');
const speciesInput = document.getElementById('species-input');
const cutInput = document.getElementById('cut-input');
const submitButton = document.getElementById('submit-skin');
const addStatus = document.getElementById('add-status');
const inventoryEl = document.getElementById('inventory');
const matchesEl = document.getElementById('matches');

populateSpeciesSelect(speciesInput);
populateCutSelect(cutInput);

let selectedFile = null;
let calibration = null;
let region = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// CIE LAB (D65) -> sRGB, for showing sampled colour as a swatch. Standard
// conversion, not calibrated against a spectrophotometer -- good enough for
// "does this look like the leather," not for judging exact hex values.
function labToCss(l, a, b) {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = 0.95047 * finv(fx);
  const y = finv(fy);
  const z = 1.08883 * finv(fz);

  const toSrgb = (c) => (c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c);
  const r = toSrgb(x * 3.2406 + y * -1.5372 + z * -0.4986);
  const g = toSrgb(x * -0.9689 + y * 1.8758 + z * 0.0415);
  const bl = toSrgb(x * 0.0557 + y * -0.204 + z * 1.057);

  const clamp = (c) => Math.max(0, Math.min(255, Math.round(c * 255)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(bl)})`;
}

function swatch(skin) {
  if (skin.colourL == null) return '';
  return `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${labToCss(skin.colourL, skin.colourA, skin.colourB)};vertical-align:middle;margin:0 4px;"></span>`;
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
  const cut = cutInput.value.trim();
  if (!label || !species || !cut) {
    addStatus.textContent = 'Label, species, and cut are required.';
    return;
  }

  addStatus.textContent = 'Computing signature…';

  const formData = new FormData();
  formData.append('photo', selectedFile);
  formData.append('label', label);
  formData.append('species', species);
  formData.append('cut', cut);
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
    cutInput.value = '';
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
      <strong>${escapeHtml(skin.label)}</strong> (${escapeHtml(skin.species)})${swatch(skin)}${skin.dominantWavelengthMm != null ? ` — ${skin.dominantWavelengthMm.toFixed(2)}mm` : ' — outline only'}
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
  const [matchesResponse, skinsResponse] = await Promise.all([
    fetch('/skins/matches'),
    fetch('/skins'),
  ]);
  const groups = await matchesResponse.json();
  const skins = await skinsResponse.json();
  const byId = new Map(skins.map((s) => [s.id, s]));
  const nameOf = (id) => escapeHtml(byId.get(id)?.label || id.slice(0, 8));
  const swatchOf = (id) => (byId.get(id) ? swatch(byId.get(id)) : '');

  matchesEl.innerHTML = groups
    .map(
      (group) => `
    <h3>${escapeHtml(group.species)}</h3>
    <ul>
      ${group.pairs
        .map((pair) => {
          const colourText =
            pair.colourDifference != null
              ? `colour difference ${pair.colourDifference.toFixed(1)}`
              : 'colour not recorded on one or both -- ranked by scale only';
          // A pair that could not be fully judged says so, rather than just
          // sitting quietly at the bottom of the list.
          const cutText = pair.unverified?.includes('cut')
            ? ' — cut not recorded on one or both, so it could not be checked'
            : '';
          return `<li>${nameOf(pair.skinAId)}${swatchOf(pair.skinAId)} &harr; ${nameOf(pair.skinBId)}${swatchOf(pair.skinBId)}: ${colourText}, ${pair.scaleDifferenceMm.toFixed(2)}mm scale difference${cutText}</li>`;
        })
        .join('')}
    </ul>
  `
    )
    .join('');
});

loadInventory();
