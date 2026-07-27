/**
 * Lifts the <style> block out of the prototype HTML into web/src/styles.css.
 *
 * Extracted rather than retyped: the stylesheet is already tuned for RTL Hebrew
 * and for the spreadsheet grid's sticky headers and cell borders, and a
 * transcription typo there would be tedious to find. Run once; after that the
 * file is edited normally.
 *
 *   npm run css:extract
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(HERE, '..', '..', 'מערכת ניהול ובקרת ייצור - איזי יוגב.html');
const OUT = path.join(HERE, '..', 'web', 'src', 'styles.css');

const html = await readFile(process.argv[2] ?? HTML, 'utf8');

const open = html.indexOf('<style>');
const close = html.indexOf('</style>', open);
if (open < 0 || close < 0) throw new Error('No <style> block found in the prototype HTML.');

const css = html.slice(open + '<style>'.length, close).trim();

const header = `/*
 * Extracted verbatim from the prototype's <style> block by
 * scripts/extract-css.ts, then extended below the marker.
 *
 * Kept as-is on purpose: the grid ergonomics, sticky headers and RTL behaviour
 * are proven in daily use. Prefer adding rules after the marker over editing
 * what is above it, so the diff against the prototype stays readable.
 */

`;

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, header + css + '\n', 'utf8');

console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${css.length} bytes of CSS)`);
console.log(`Custom properties found: ${[...css.matchAll(/--[\w-]+:/g)].length}`);
