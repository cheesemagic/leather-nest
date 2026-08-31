export function attachRegionSelect(container, imgSrc, onComplete) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';

  const img = document.createElement('img');
  img.src = imgSrc;
  img.style.display = 'block';
  img.style.maxWidth = '100%';

  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.cursor = 'crosshair';

  wrapper.appendChild(img);
  wrapper.appendChild(overlay);
  container.appendChild(wrapper);

  let dragStart = null;
  let dragEnd = null;

  function resizeOverlay() {
    overlay.width = img.clientWidth;
    overlay.height = img.clientHeight;
  }

  function toNatural(displayX, displayY) {
    return {
      x: (displayX / overlay.width) * img.naturalWidth,
      y: (displayY / overlay.height) * img.naturalHeight,
    };
  }

  function displayPoint(event) {
    const rect = overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function drawRect() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!dragStart || !dragEnd) return;
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  img.addEventListener('load', resizeOverlay);
  window.addEventListener('resize', resizeOverlay);

  overlay.addEventListener('mousedown', (event) => {
    dragStart = displayPoint(event);
    dragEnd = dragStart;
    drawRect();
  });

  overlay.addEventListener('mousemove', (event) => {
    if (!dragStart) return;
    dragEnd = displayPoint(event);
    drawRect();
  });

  overlay.addEventListener('mouseup', (event) => {
    if (!dragStart) return;
    dragEnd = displayPoint(event);
    drawRect();

    const startNatural = toNatural(dragStart.x, dragStart.y);
    const endNatural = toNatural(dragEnd.x, dragEnd.y);
    dragStart = null;

    const roiX = Math.min(startNatural.x, endNatural.x);
    const roiY = Math.min(startNatural.y, endNatural.y);
    const roiWidth = Math.abs(endNatural.x - startNatural.x);
    const roiHeight = Math.abs(endNatural.y - startNatural.y);

    if (roiWidth < 1 || roiHeight < 1) return;

    onComplete({ roiX, roiY, roiWidth, roiHeight });
  });
}
