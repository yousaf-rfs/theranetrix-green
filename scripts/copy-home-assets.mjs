import {cp, mkdir} from 'node:fs/promises';

// Only the assets used by the home design are published; the feedback service
// loader belongs to the full application and is intentionally excluded.
for (const asset of ['favicon.svg', 'fonts', 'design-preview']) {
  const destination = new URL('../frontend/public/' + asset, import.meta.url);
  await mkdir(new URL('../frontend/public/', import.meta.url), {recursive: true});
  await cp(new URL('../public/' + asset, import.meta.url), destination, {recursive: true});
}
