import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const result = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['safari16'], write: false, legalComments: 'inline' });
const template = await readFile('src/template.html', 'utf8');
const css = await readFile('src/style.css', 'utf8');
const threeLicense = await readFile('node_modules/three/LICENSE', 'utf8');
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Function replacers preserve literal $&, $` and $' inside minified JavaScript.
await writeFile('index.html', template.replace('/* STYLES */', () => css).replace('/* GAME */', () => `/* Three.js 0.180.0\n${threeLicense}\n*/\n${js}`));
console.log(`Built index.html: ${(Buffer.byteLength(js) / 1024).toFixed(0)} KB JavaScript, all dependencies embedded.`);
