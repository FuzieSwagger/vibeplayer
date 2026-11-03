'use strict';

// Собирает portable-версию M'uzie для Windows без electron-packager:
// копирует готовый Electron, упаковывает сайт в app.asar и патчит иконку exe.

const fs = require('node:fs');
const path = require('node:path');
const { createPackage } = require('@electron/asar');
const { rcedit } = require('rcedit');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'Muzie-win32-x64');
const STAGE = path.join(ROOT, 'build', 'app');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist');
const pkg = require(path.join(ROOT, 'package.json'));

const APP_FILES = ['index.html', 'style.css', 'script.js', 'package.json', 'LICENSE', 'README.md'];
const APP_DIRS = ['assets', 'electron'];

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

async function main() {
  if (!fs.existsSync(path.join(ELECTRON, 'electron.exe'))) {
    throw new Error('Electron не установлен: выполните npm install');
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(STAGE, { recursive: true });

  copy(ELECTRON, OUT);
  fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'Muzie.exe'));
  fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

  for (const file of APP_FILES) {
    copy(path.join(ROOT, file), path.join(STAGE, file));
  }
  for (const dir of APP_DIRS) {
    copy(path.join(ROOT, dir), path.join(STAGE, dir));
  }

  await createPackage(STAGE, path.join(OUT, 'resources', 'app.asar'));
  fs.rmSync(STAGE, { recursive: true, force: true });

  await rcedit(path.join(OUT, 'Muzie.exe'), {
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    'file-version': `${pkg.version}.0`,
    'product-version': `${pkg.version}.0`,
    'version-string': {
      CompanyName: pkg.author,
      FileDescription: pkg.description,
      ProductName: "M'uzie",
      InternalName: 'Muzie',
      OriginalFilename: 'Muzie.exe',
      LegalCopyright: 'MIT License'
    }
  });

  const exe = path.join(OUT, 'Muzie.exe');
  const size = fs.statSync(exe).size;
  console.log(`Готово: ${exe} (${(size / 1024 / 1024).toFixed(1)} МБ)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
