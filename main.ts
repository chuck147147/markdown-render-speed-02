import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const source = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(join(source, 'cases.json'), 'utf8'));
const rendered = cases.map(({ markdown }) => parse(markdown));
writeFileSync(join(destination, 'html.json'), JSON.stringify(rendered));
