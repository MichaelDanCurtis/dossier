import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
const source = path.resolve('extensions/careerai-job-clipper');
const files = {};
for (const name of await readdir(source)) {
  if (['manifest.json', 'popup.html', 'popup.css', 'popup.mjs', 'extract.mjs', 'search.mjs', 'api.mjs', 'worker.mjs', 'panel.js', 'workspace-engine.mjs', 'workspace-capture.mjs', 'README.md', 'icon.png', 'LICENSE'].includes(name)) files[name] = new Uint8Array(await readFile(path.join(source, name)));
}
if (!files['manifest.json'] || !files['popup.mjs']) throw new Error('Extension source is incomplete.');
await mkdir('public', { recursive: true });
await writeFile('public/careerai-job-clipper.zip', zipSync(files, { level: 9 }));
console.log('Packaged CareerAI Chrome extension.');
