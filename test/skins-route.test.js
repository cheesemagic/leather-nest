import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withServer as withServerBase } from './helpers/with-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'test-grid-10px.png');

function withServer(fn) {
  return withServerBase(fn, { withDataDir: true });
}

async function postSkin(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(FIXTURE);
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'skin.png');
  const fields = {
    label: 'Test Skin',
    species: 'cayman',
    cut: 'tail',
    roiX: 0,
    roiY: 0,
    roiWidth: 256,
    roiHeight: 256,
    p1x: 0,
    p1y: 0,
    p2x: 100,
    p2y: 0,
    realDistanceMm: 100,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/skins`, { method: 'POST', body: formData });
}

async function postOutlineSkin(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(path.join(__dirname, 'fixtures', 'test-rectangle.png'));
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'hide.png');
  const fields = {
    captureType: 'outline',
    label: 'Test Hide',
    species: 'cayman',
    thicknessMm: 1.4,
    p1x: 0,
    p1y: 0,
    p2x: 200,
    p2y: 0,
    realDistanceMm: 100,
    roiX: 0,
    roiY: 0,
    roiWidth: 400,
    roiHeight: 300,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/skins`, { method: 'POST', body: formData });
}

test('POST /skins creates a skin and GET /skins lists it', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await postSkin(baseUrl);
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.ok(created.id);
    assert.ok(created.dominantWavelengthMm > 0);

    const list = await (await fetch(`${baseUrl}/skins`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('GET /skins/:id/photo serves the stored photo', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSkin(baseUrl)).json();
    const response = await fetch(`${baseUrl}/skins/${created.id}/photo`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
  });
});

test('GET /skins/:id/photo returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/skins/does-not-exist/photo`);
    assert.equal(response.status, 404);
  });
});

test('DELETE /skins/:id removes it, GET /skins no longer lists it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSkin(baseUrl)).json();
    const deleteResponse = await fetch(`${baseUrl}/skins/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);

    const list = await (await fetch(`${baseUrl}/skins`)).json();
    assert.equal(list.length, 0);
  });
});

test('DELETE /skins/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/skins/does-not-exist`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });
});

test('GET /skins/matches groups same-species pairs and excludes cross-species pairs', async () => {
  await withServer(async (baseUrl) => {
    await postSkin(baseUrl, { label: 'Cayman A', species: 'cayman' });
    await postSkin(baseUrl, { label: 'Cayman B', species: 'cayman' });
    await postSkin(baseUrl, { label: 'Croc A', species: 'crocodile' });

    const matches = await (await fetch(`${baseUrl}/skins/matches`)).json();
    assert.equal(matches.find((g) => g.species === 'cayman').pairs.length, 1);
    assert.equal(matches.find((g) => g.species === 'crocodile').pairs.length, 0);
  });
});

test('GET /skins and GET /skins/matches handle a mixed signature+outline store without error', async () => {
  await withServer(async (baseUrl) => {
    await postSkin(baseUrl, { label: 'Cayman A', species: 'cayman' });
    await postOutlineSkin(baseUrl, { label: 'Outline Hide', species: 'cayman' });

    const list = await (await fetch(`${baseUrl}/skins`)).json();
    assert.equal(list.length, 2);
    const signatureSkin = list.find((s) => s.dominantWavelengthMm != null);
    const outlineHide = list.find((s) => s.dominantWavelengthMm == null);
    assert.ok(signatureSkin);
    assert.equal(outlineHide.dominantWavelengthMm, null);

    const matchesResponse = await fetch(`${baseUrl}/skins/matches`);
    assert.equal(matchesResponse.status, 200);
    const matches = await matchesResponse.json();
    const matchesText = JSON.stringify(matches);
    assert.ok(!matchesText.includes('NaN'));
    for (const group of matches) {
      for (const pair of group.pairs) {
        assert.notEqual(pair.skinAId, outlineHide.id);
        assert.notEqual(pair.skinBId, outlineHide.id);
      }
    }
  });
});

test('POST /skins returns 422 with a clear error when the region is too small', async () => {
  await withServer(async (baseUrl) => {
    const response = await postSkin(baseUrl, { roiWidth: 5, roiHeight: 5 });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /too small/);
  });
});

test('POST /skins returns 400 when label is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postSkin(baseUrl, { label: '' });
    assert.equal(response.status, 400);
  });
});

test('GET / still serves the static site (existing behavior preserved)', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
  });
});

test('POST /skins with captureType=outline creates a hide with outline/thickness and no signature fields', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(Array.isArray(created.outlinePolygon));
    assert.ok(created.outlinePolygon.length >= 3);
    assert.equal(created.thicknessMm, 1.4);
    assert.equal(created.remainingAreaPct, 100);
    assert.equal(created.dominantWavelengthMm, null);
    // test-rectangle.png's piece is black on white -- near-zero on all three
    // LAB axes, and nowhere near the white background's L~100.
    assert.ok(Math.abs(created.colourL) < 10, `expected colourL near 0, got ${created.colourL}`);
    assert.ok(Math.abs(created.colourA) < 5, `expected colourA near 0, got ${created.colourA}`);
    assert.ok(Math.abs(created.colourB) < 5, `expected colourB near 0, got ${created.colourB}`);
  });
});

test('POST /skins with captureType omitted still creates a signature hide (default unchanged)', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSkin(baseUrl)).json();
    assert.ok(created.dominantWavelengthMm > 0);
    assert.equal(created.outlinePolygon, null);
    assert.equal(created.remainingAreaPct, 100);
  });
});

test('POST /skins with captureType=signature also samples colour from the same region', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSkin(baseUrl)).json();
    // The scale-matching path used to have no colour at all -- this is the
    // fix for match-skins.html ranking on the wrong attribute.
    assert.equal(typeof created.colourL, 'number');
    assert.equal(typeof created.colourA, 'number');
    assert.equal(typeof created.colourB, 'number');
  });
});

test('POST /skins with captureType=outline returns 400 when thicknessMm is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, { thicknessMm: undefined });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /thicknessMm/);
  });
});

test('POST /skins with captureType=outline stores an operator-set finish label, null when omitted', async () => {
  await withServer(async (baseUrl) => {
    const withFinish = await (await postOutlineSkin(baseUrl, { finish: 'glossy' })).json();
    assert.equal(withFinish.finish, 'glossy');

    const withoutFinish = await (await postOutlineSkin(baseUrl)).json();
    assert.equal(withoutFinish.finish, null);
  });
});

test('POST /skins returns 400 for an unknown captureType', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, { captureType: 'bogus' });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /captureType/);
  });
});

test('POST /skins with captureType=outline and no ROI fields still succeeds (omits all four from args)', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, {
      roiX: undefined,
      roiY: undefined,
      roiWidth: undefined,
      roiHeight: undefined,
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(Array.isArray(created.outlinePolygon));
    assert.ok(created.outlinePolygon.length >= 3);
    assert.equal(created.thicknessMm, 1.4);
  });
});

test('POST /skins with captureType=outline and a scale patch also measures the hide for matching', async () => {
  await withServer(async (baseUrl) => {
    // This fixture is a bounded shape WITH scale-like texture inside it --
    // the only one that exercises both scripts at once, which is exactly
    // what adding a hide "for matching" does.
    const fileBuffer = await readFile(path.join(__dirname, 'fixtures', 'test-textured-hide.png'));
    const formData = new FormData();
    formData.append('photo', new Blob([fileBuffer]), 'hide.png');
    const fields = {
      captureType: 'outline',
      label: 'Matchable Hide',
      species: 'python',
      thicknessMm: 1.4,
      // 100px between the calibration points over 100mm -> 1mm per pixel.
      p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100,
      captureForMatching: 'true',
      cut: 'whole',
      // A patch inside the shape, on the texture -- not the outline region.
      matchRoiX: 100, matchRoiY: 100, matchRoiWidth: 160, matchRoiHeight: 160,
    };
    for (const [key, value] of Object.entries(fields)) formData.append(key, String(value));

    const response = await fetch(`${baseUrl}/skins`, { method: 'POST', body: formData });
    assert.equal(response.status, 200);
    const created = await response.json();

    // Both measurements on one record: the outline it was added for, and the
    // scale signature that makes it visible to matching.
    assert.ok(Array.isArray(created.outlinePolygon), 'should still capture the outline');
    assert.ok(Array.isArray(created.radialSpectrum));
    assert.equal(created.warning, undefined);
    // The fixture's grid is 10px at 1mm/px, so a correct measurement is 10mm
    // -- asserting the value, not merely that one was produced.
    assert.ok(
      Math.abs(created.dominantWavelengthMm - 10) < 1,
      `expected ~10mm scale from the fixture's grid, got ${created.dominantWavelengthMm}`
    );

    // The real point -- a hide added through the Hides page now reaches the
    // matching page, which filters on exactly this field.
    const matches = await (await fetch(`${baseUrl}/skins/matches`)).json();
    assert.ok(
      matches.find((g) => g.species === 'python'),
      'a hide added through the Hides page should reach matching'
    );
  });
});

test('POST /skins with captureType=outline and no scale patch stays unmatchable, as before', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl)).json();
    assert.ok(Array.isArray(created.outlinePolygon));
    assert.equal(created.dominantWavelengthMm, null);
    assert.equal(created.warning, undefined);
  });
});

test('a scale patch that cannot be measured still saves the hide, with a warning', async () => {
  await withServer(async (baseUrl) => {
    // A 5x5 region is under skin_signature.py's 32px floor, so the
    // measurement fails -- but the outline and calibration work behind it
    // must not be thrown away with it.
    const response = await postOutlineSkin(baseUrl, {
      captureForMatching: 'true',
      cut: 'whole',
      matchRoiX: 0, matchRoiY: 0, matchRoiWidth: 5, matchRoiHeight: 5,
    });
    assert.equal(response.status, 200, 'the hide itself should still be created');
    const created = await response.json();

    assert.ok(Array.isArray(created.outlinePolygon), 'the outline survives');
    assert.equal(created.dominantWavelengthMm, null, 'but it is not matchable');
    assert.match(created.warning, /matching/i);

    // The warning describes the attempt, not the hide -- it must not persist.
    const stored = (await (await fetch(`${baseUrl}/skins`)).json())[0];
    assert.equal(stored.warning, undefined);
  });
});

function postSignature(baseUrl, id, overrides = {}) {
  const formData = new FormData();
  const fields = {
    // 100px over 100mm -> 1mm per pixel, matching the fixture's 10px grid.
    p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100,
    roiX: 100, roiY: 100, roiWidth: 160, roiHeight: 160,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/skins/${id}/signature`, { method: 'POST', body: formData });
}

async function postTexturedHide(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(path.join(__dirname, 'fixtures', 'test-textured-hide.png'));
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'hide.png');
  const fields = {
    captureType: 'outline',
    label: 'Textured Hide',
    species: 'python',
    thicknessMm: 1.4,
    p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/skins`, { method: 'POST', body: formData });
}

test('POST /skins/:id/signature measures an existing hide from its stored photo, making it matchable', async () => {
  await withServer(async (baseUrl) => {
    // A hide added WITHOUT the matching toggle -- the case this route exists
    // for: already in the library, and not matchable.
    const created = await (await postTexturedHide(baseUrl)).json();
    assert.equal(created.dominantWavelengthMm, null, 'starts out unmatchable');

    const response = await postSignature(baseUrl, created.id, { cut: 'whole' });
    assert.equal(response.status, 200);
    const measured = await response.json();

    // The fixture's grid is 10px at 1mm/px, so a correct measurement is 10mm.
    assert.ok(
      Math.abs(measured.dominantWavelengthMm - 10) < 1,
      `expected ~10mm, got ${measured.dominantWavelengthMm}`
    );
    assert.ok(Array.isArray(measured.radialSpectrum));
  });
});

test('POST /skins/:id/signature leaves everything else about the hide alone', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postTexturedHide(baseUrl, { finish: 'matte' })).json();
    const measured = await (await postSignature(baseUrl, created.id, { cut: 'whole' })).json();

    assert.deepEqual(measured.outlinePolygon, created.outlinePolygon);
    assert.equal(measured.label, created.label);
    assert.equal(measured.finish, 'matte');
    assert.equal(measured.thicknessMm, created.thicknessMm);
    assert.equal(measured.colourL, created.colourL);
    assert.equal(measured.remainingAreaPct, created.remainingAreaPct);
    assert.equal(measured.createdAt, created.createdAt);
  });
});

test('POST /skins/:id/signature returns 422 and changes nothing when the patch cannot be measured', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postTexturedHide(baseUrl)).json();
    // Under skin_signature.py's 32px floor.
    const response = await postSignature(baseUrl, created.id, { cut: 'whole', roiWidth: 5, roiHeight: 5 });
    assert.equal(response.status, 422);

    const stored = (await (await fetch(`${baseUrl}/skins`)).json())[0];
    assert.equal(stored.dominantWavelengthMm, null, 'a failed measurement must not be stored');
  });
});

test('POST /skins/:id/signature returns 404 for an unknown id and 400 without a calibration', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await postSignature(baseUrl, 'does-not-exist')).status, 404);

    const created = await (await postTexturedHide(baseUrl)).json();
    const missingCalibration = await postSignature(baseUrl, created.id, {
      p1x: undefined, p1y: undefined, p2x: undefined, p2y: undefined, realDistanceMm: undefined,
    });
    assert.equal(missingCalibration.status, 400);
  });
});

async function postRedigitize(baseUrl, id, overrides = {}) {
  const fileBuffer = await readFile(path.join(__dirname, 'fixtures', 'test-rectangle.png'));
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'remainder.png');
  const fields = {
    p1x: 0,
    p1y: 0,
    p2x: 200,
    p2y: 0,
    realDistanceMm: 100,
    roiX: 0,
    roiY: 0,
    roiWidth: 400,
    roiHeight: 300,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/skins/${id}/redigitize`, { method: 'POST', body: formData });
}

test('POST /skins/:id/redigitize replaces outline/colour and resets remainingAreaPct, keeping the same id', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl)).json();

    const response = await postRedigitize(baseUrl, created.id);
    assert.equal(response.status, 200);
    const updated = await response.json();

    assert.equal(updated.id, created.id);
    assert.ok(Array.isArray(updated.outlinePolygon));
    assert.ok(updated.outlinePolygon.length >= 3);
    assert.equal(updated.remainingAreaPct, 100);
    assert.equal(typeof updated.colourL, 'number');

    const list = await (await fetch(`${baseUrl}/skins`)).json();
    assert.equal(list.length, 1, 'redigitize updates the existing record rather than creating a new one');
  });
});

test('POST /skins/:id/redigitize returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await postRedigitize(baseUrl, 'does-not-exist');
    assert.equal(response.status, 404);
  });
});

test('POST /skins/:id/redigitize returns 400 when no photo is uploaded', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl)).json();
    const formData = new FormData();
    formData.append('p1x', '0');
    const response = await fetch(`${baseUrl}/skins/${created.id}/redigitize`, {
      method: 'POST',
      body: formData,
    });
    assert.equal(response.status, 400);
  });
});

test('POST /skins with captureType=outline and partial ROI fields behaves as no ROI (hasROI guard requires all four)', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, {
      roiX: 10,
      roiY: undefined,
      roiWidth: undefined,
      roiHeight: undefined,
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(Array.isArray(created.outlinePolygon));
    assert.ok(created.outlinePolygon.length >= 3);
    assert.equal(created.thicknessMm, 1.4);
  });
});

const CUT_REQUIRED = 'cut is required when measuring a hide for matching.';

test('POST /skins rejects a signature capture with no cut', async () => {
  await withServer(async (baseUrl) => {
    const response = await postSkin(baseUrl, { cut: undefined });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, CUT_REQUIRED);
    // Nothing was created, and the upload was cleaned up.
    assert.deepEqual(await (await fetch(`${baseUrl}/skins`)).json(), []);
  });
});

test('POST /skins stores the cut on a signature capture', async () => {
  await withServer(async (baseUrl) => {
    const response = await postSkin(baseUrl, { cut: 'tail' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cut, 'tail');
  });
});

test('POST /skins allows an outline-only hide with no cut', async () => {
  await withServer(async (baseUrl) => {
    // Photographing an offcut purely to nest on it must not be blocked by a
    // question that has no bearing on nesting.
    const response = await postOutlineSkin(baseUrl);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cut, null);
  });
});

test('POST /skins rejects an outline capture that also asks for matching with no cut', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, {
      captureForMatching: 'true',
      matchRoiX: 0,
      matchRoiY: 0,
      matchRoiWidth: 100,
      matchRoiHeight: 100,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, CUT_REQUIRED);
    assert.deepEqual(await (await fetch(`${baseUrl}/skins`)).json(), []);
  });
});

test('POST /skins/:id/signature demands a cut when the hide has none', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl)).json();
    assert.equal(created.cut, null);

    const response = await postSignature(baseUrl, created.id);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, CUT_REQUIRED);
  });
});

test('POST /skins/:id/signature does not re-ask a hide that already has a cut', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl, { cut: 'belly' })).json();
    assert.equal(created.cut, 'belly');

    // 200 on a real measurement, 422 if the fixture defeats the FFT -- either
    // way it must not be the 400 that means "cut is missing".
    const response = await postSignature(baseUrl, created.id);
    assert.notEqual(response.status, 400);
  });
});

function patchSkin(baseUrl, id, payload) {
  return fetch(`${baseUrl}/skins/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('POST /skins/:id corrects the operator-set fields', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl, { cut: 'tail' })).json();

    const response = await patchSkin(baseUrl, created.id, {
      label: 'Renamed',
      species: 'alligator',
      cut: 'belly',
      finish: 'matte',
      thicknessMm: 1.9,
    });
    assert.equal(response.status, 200);
    const updated = await response.json();

    assert.equal(updated.label, 'Renamed');
    assert.equal(updated.species, 'alligator');
    assert.equal(updated.cut, 'belly');
    assert.equal(updated.finish, 'matte');
    assert.equal(updated.thicknessMm, 1.9);
    // The measured half is untouched.
    assert.deepEqual(updated.outlinePolygon, created.outlinePolygon);
    assert.equal(updated.colourA, created.colourA);
    assert.equal(updated.createdAt, created.createdAt);
  });
});

test('POST /skins/:id refuses to clear the cut of a matchable hide', async () => {
  await withServer(async (baseUrl) => {
    // The rule this protects: every hide that carries a scale signature has a
    // cut. Without this check, editing is a back door around the three
    // capture routes that all enforce it.
    const created = await (await postSkin(baseUrl, { cut: 'tail' })).json();
    assert.ok(created.dominantWavelengthMm != null, 'this hide is matchable');

    const response = await patchSkin(baseUrl, created.id, { cut: null });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /matchable|signature|measured/i);

    // Unchanged on disk.
    const after = (await (await fetch(`${baseUrl}/skins`)).json())[0];
    assert.equal(after.cut, 'tail');
  });
});

test('POST /skins/:id allows clearing the cut of a hide that is not matchable', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl, { cut: 'tail' })).json();
    assert.equal(created.dominantWavelengthMm, null, 'outline only, not matchable');

    const response = await patchSkin(baseUrl, created.id, { cut: null });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cut, null);
  });
});

test('POST /skins/:id rejects an empty species and an empty label', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl)).json();

    assert.equal((await patchSkin(baseUrl, created.id, { species: '' })).status, 400);
    assert.equal((await patchSkin(baseUrl, created.id, { species: null })).status, 400);
    assert.equal((await patchSkin(baseUrl, created.id, { label: '  ' })).status, 400);
  });
});

test('POST /skins/:id rejects a nonsense thickness', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl)).json();
    assert.equal((await patchSkin(baseUrl, created.id, { thicknessMm: -1 })).status, 400);
    assert.equal((await patchSkin(baseUrl, created.id, { thicknessMm: 'thick' })).status, 400);
    assert.equal((await patchSkin(baseUrl, created.id, { thicknessMm: 0 })).status, 400);
  });
});

test('POST /skins/:id rejects an unknown field instead of silently ignoring it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postOutlineSkin(baseUrl)).json();
    // This route exists to fix mislabels, so a typo that appears to succeed
    // while changing nothing is the exact failure it must not have.
    const response = await patchSkin(baseUrl, created.id, { cutt: 'belly' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cutt/);

    // Measured fields are rejected by the same rule, with a clearer reason.
    const measured = await patchSkin(baseUrl, created.id, { colourA: 99 });
    assert.equal(measured.status, 400);
    assert.match((await measured.json()).error, /colourA/);
  });
});

test('POST /skins/:id 404s for an unknown hide and 400s on a broken body', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await patchSkin(baseUrl, 'does-not-exist', { label: 'x' })).status, 404);

    const created = await (await postOutlineSkin(baseUrl)).json();
    const broken = await fetch(`${baseUrl}/skins/${created.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(broken.status, 400);
  });
});
