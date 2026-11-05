import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const models = JSON.parse(await readFile('client/src/omr/models.json', 'utf8'));
let failed = 0;
for (const model of models) {
  const path = `client/public/models/${model.path}`;
  try {
    const file = await stat(path);
    if (file.size !== model.bytes)
      throw new Error(`size ${file.size}, expected ${model.bytes}`);
    const hash = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    if (hash !== model.sha256) throw new Error('SHA-256 mismatch');
    console.log(`OK ${model.id}`);
  } catch (error) {
    failed++;
    console.error(`MISSING/INVALID ${path}: ${error.message}`);
  }
}
if (failed) {
  console.error(
    `${failed} models unavailable. Run npm run models:download, then npm run models:check.`,
  );
  process.exitCode = 1;
}
