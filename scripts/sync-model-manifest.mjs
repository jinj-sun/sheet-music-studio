import {
  ARTIFACTS,
  MODEL_ROLES,
} from '../node_modules/homr-web/dist/models/manifest.js';
import { mkdir, writeFile } from 'node:fs/promises';
const ids = [...new Set(Object.values(MODEL_ROLES).map((role) => role.cpu))];
const models = ids.map((id) => ({
  id,
  ...(({ sha256, bytes, urlPath }) => ({ sha256, bytes, path: urlPath }))(
    ARTIFACTS[id],
  ),
}));
await mkdir('client/src/omr', { recursive: true });
await writeFile(
  'client/src/omr/models.json',
  JSON.stringify(models, null, 2) + '\n',
);
console.log(
  `Pinned ${models.length} WASM model artifacts from installed homr-web 0.5.4`,
);
