import fs from 'node:fs/promises';
import { manualMarkdown } from '../src/host/ui/help-document.ts';

const file = new URL('../docs/user-manual.md', import.meta.url);
await fs.writeFile(file, manualMarkdown());
process.stdout.write('Updated docs/user-manual.md from the product help content.\n');
