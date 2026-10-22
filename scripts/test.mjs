import ts from 'typescript';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'coinpulse-tests-'));
try {
 await mkdir(join(dir,'app'));await mkdir(join(dir,'tests'));
 for (const route of ['radar','markets']) {
  await mkdir(join(dir,'app','api',route),{recursive:true});
  const source=await readFile(new URL('../app/api/'+route+'/route.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll("'../../asset-identity'","'../../asset-identity.mjs'").replaceAll("'../radar/route'","'../radar/route.mjs'");
  await writeFile(join(dir,'app','api',route,'route.mjs'),code);
 }
 for (const name of ['market-utils','forecast-model','asset-identity','browser-data','comparison-model','forecast-evaluation','forecast-reference','forecast-candidates','forecast-signals']) {
  const source=await readFile(new URL('../app/'+name+'.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll("'./asset-identity'","'./asset-identity.mjs'").replaceAll("'./forecast-model'","'./forecast-model.mjs'").replaceAll("'./forecast-evaluation'","'./forecast-evaluation.mjs'").replaceAll("'./forecast-signals'","'./forecast-signals.mjs'");
  await writeFile(join(dir,'app',name+'.mjs'),code);
 }
 for (const name of ['check-market-utils','check-forecast','check-asset-identity','check-browser-data','check-comparison','check-forecast-evaluation','check-forecast-reference','check-forecast-candidates','check-forecast-signals']) {
  const source=(await readFile(new URL('../tests/'+name+'.mjs',import.meta.url),'utf8')).replaceAll(".ts'",".mjs'");
  const target=join(dir,'tests',name+'.mjs');await writeFile(target,source);await import(pathToFileURL(target).href);
 }
} finally { await rm(dir,{recursive:true,force:true}); }
