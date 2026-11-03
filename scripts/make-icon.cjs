'use strict';

// Собирает assets/icon.ico из assets/favicon.svg без сторонних библиотек:
// Electron рендерит SVG в PNG через canvas, Node упаковывает PNG в ICO.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'assets', 'favicon.svg');
const ICO = path.join(ROOT, 'assets', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, png }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry);
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG);
  const html = `<!doctype html><meta charset="utf-8"><canvas id="canvas"></canvas><script>
    const img = new Image();
    img.onload = () => { window.iconReady = true; };
    img.onerror = () => { window.iconError = 'svg load failed'; };
    img.src = 'data:image/svg+xml;base64,${svg.toString('base64')}';
    window.render = (size) => {
      const canvas = document.getElementById('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/png');
    };
  </script>`;

  const win = new BrowserWindow({
    show: false,
    width: 300,
    height: 300,
    webPreferences: { offscreen: true, sandbox: true }
  });

  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      if (window.iconReady) return resolve(true);
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.iconReady) { clearInterval(timer); resolve(true); }
        else if (window.iconError || Date.now() - started > 5000) {
          clearInterval(timer); reject(new Error(window.iconError || 'timeout'));
        }
      }, 50);
    })`);

    const images = [];
    for (const size of SIZES) {
      const dataUrl = await win.webContents.executeJavaScript(`window.render(${size})`);
      const png = Buffer.from(String(dataUrl).split(',')[1], 'base64');
      images.push({ size, png });
    }

    fs.mkdirSync(path.join(ROOT, 'build', 'icons'), { recursive: true });
    for (const { size, png } of images) {
      fs.writeFileSync(path.join(ROOT, 'build', 'icons', `icon-${size}.png`), png);
    }
    fs.writeFileSync(ICO, buildIco(images));
    console.log(`icon.ico: ${ICO} (${SIZES.join(', ')} px)`);
  } finally {
    win.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
