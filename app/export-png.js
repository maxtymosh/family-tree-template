'use strict';

window.TreeExportPNG = (() => {
  const unavailable = 'Не вдалося створити PNG. Спробуйте зберегти схему як PDF.';
  const copyAlternative = 'Браузер не дозволив скопіювати зображення. Натисніть «PNG», щоб завантажити його.';

  async function draw(svg, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // Resize the vector image itself before decoding so text rasterizes at the output resolution.
    const imageSource = svg.cloneNode(true);
    imageSource.setAttribute('width', width);
    imageSource.setAttribute('height', height);
    const xml = new XMLSerializer().serializeToString(imageSource);
    const imageURL = URL.createObjectURL(new Blob([xml], {type: 'image/svg+xml;charset=utf-8'}));
    try {
      const image = new Image();
      image.src = imageURL;
      await image.decode();
      const context = canvas.getContext('2d');
      if (!context) throw new Error(unavailable);
      context.drawImage(image, 0, 0, width, height);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png || !png.size) throw new Error(unavailable);
      return png;
    } finally {
      URL.revokeObjectURL(imageURL);
      // Release the backing store promptly; a subsequent clipboard conversion also needs memory.
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async function render(svg) {
    const {width, height} = svg.viewBox.baseVal;
    if (!(width > 0 && height > 0)) throw new Error(unavailable);
    const touch = matchMedia('(pointer: coarse)').matches;
    const maxPixels = touch ? 16_000_000 : 56_000_000;
    const maxSide = 16_384;
    // Proportional caps keep wide multi-generation charts within browser canvas limits.
    let scale = Math.min(3, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
    for (let attempt = 0; attempt < 2; attempt++) {
      const w = Math.max(1, Math.floor(width * scale));
      const h = Math.max(1, Math.floor(height * scale));
      try {
        return await draw(svg, w, h);
      } catch {
        // A browser with a smaller canvas budget can still export the entire chart.
        scale *= 0.65;
      }
    }
    throw new Error(unavailable);
  }

  async function download(svg, filename) {
    const png = await render(svg);
    const link = document.createElement('a');
    const url = URL.createObjectURL(png);
    link.href = url;
    link.download = filename.toLowerCase().endsWith('.png') ? filename : filename + '.png';
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      // Allow the download process (including Safari's preview) to take ownership first.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async function copy(svg) {
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error(copyAlternative);
    const png = Promise.resolve(svg).then(render);
    async function write() {
      try {
        // Safari checks user activation on write(), before image decoding has finished.
        await navigator.clipboard.write([new ClipboardItem({'image/png': png})]);
      } catch {
        throw new Error(copyAlternative);
      }
    }
    await Promise.all([png, write()]);
  }

  return {download, copy};
})();
