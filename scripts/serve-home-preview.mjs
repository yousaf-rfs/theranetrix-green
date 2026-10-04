import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createPreviewHandler} from '../preview-access/handler.mjs';

const port = Number(process.env.PORT || 3032);
const handler = createPreviewHandler({root: fileURLToPath(new URL('../frontend/out/', import.meta.url))});
createServer(handler).listen(port, '127.0.0.1', () => {
  console.log(`Forest Green protected preview: http://127.0.0.1:${port}`);
  if (!process.env.PREVIEW_PASSWORD) console.log('Preview locked: set PREVIEW_PASSWORD to a password of 12–256 characters.');
});
