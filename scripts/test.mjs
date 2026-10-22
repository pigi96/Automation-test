import ts from 'typescript';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'coinpulse-tests-'));
try {
 await mkdir(join(dir,'app'));await mkdir(join(dir,'tests'));
 for (const name of ['market-utils','forecast-model']) {
  const source=await readFile(new URL('../app/'+name+'.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  await writeFile(join(dir,'app',name+'.mjs'),code);
 }
 for (const name of ['check-market-utils','check-forecast']) {
  const source=(await readFile(new URL('../tests/'+name+'.mjs',import.meta.url),'utf8')).replaceAll(".ts'",".mjs'");
  const target=join(dir,'tests',name+'.mjs');await writeFile(target,source);await import(pathToFileURL(target).href);
 }
} finally { await rm(dir,{recursive:true,force:true}); }
