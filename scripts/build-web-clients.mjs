import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),npm=process.env.npm_execpath;
if(!npm)throw Error('Run this builder through npm run build');
for(const workspace of ['@dustpact/web','@dustpact/recovery']){
 const result=spawnSync(process.execPath,[npm,'run','build','--workspace',workspace],{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.status!==0)process.exit(result.status??1);
}
