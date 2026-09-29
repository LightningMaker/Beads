'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const stagingRoot = path.join(projectRoot, '.utmp');
const outputDirectory = path.join(stagingRoot, 'bead-pattern-pages');
const files = ['index.html', '.nojekyll'];

// Keep generated output inside this project, including when rerunning on Windows.
if (path.dirname(outputDirectory) !== stagingRoot || path.dirname(stagingRoot) !== projectRoot) {
  throw new Error('Unexpected Pages staging path.');
}
for (const directory of [stagingRoot, outputDirectory]) {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error(`Pages staging must be a regular directory: ${directory}`);
  }
}
for (const file of files) {
  const source = path.join(__dirname, file);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Pages source must be a regular file: ${source}`);
  }
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(__dirname, file), path.join(outputDirectory, file));
}

const actualFiles = fs.readdirSync(outputDirectory).sort();
if (JSON.stringify(actualFiles) !== JSON.stringify([...files].sort())) {
  throw new Error('Pages output contains unexpected files.');
}
console.log(`Pages files prepared in ${outputDirectory}`);
console.log(`Included: ${actualFiles.join(', ')}`);
