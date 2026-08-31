export function attachImageOverlay(container, imgSrc, onResize) {
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

  function resizeOverlay() {
    overlay.width = img.clientWidth;
    overlay.height = img.clientHeight;
    if (onResize) onResize();
  }

  img.addEventListener('load', resizeOverlay);
  window.addEventListener('resize', resizeOverlay);

  return { img, overlay };
}
