// lib/product-names.ts for tests, so assertions follow the configured advisor name
// instead of spelling it out.
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../../lib/product-names.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
export const {ADVISOR_NAME,ADVISOR_SENDER,ADVISOR_HANDOFF_SOURCE,ADVISOR_SUMMARY_LABEL,ADVISOR_EXCHANGE_LABEL,ADVISOR_INTEGRATION_NAME,LEGACY_ADVISOR_NAME}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
