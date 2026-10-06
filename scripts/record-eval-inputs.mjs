import {readFile, writeFile, lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from './build-plugin.mjs';
import {readSnippets, sha256} from './extract-snippets.mjs';
import {checkEvals} from './check-evals.mjs';

export async function evalInputs(root=repositoryRoot){
 await checkEvals(root);
 const config=JSON.parse(await readFile(path.join(root,'plugin.config.json'),'utf8'));
 const catalog=JSON.parse(await readFile(path.join(root,'evals/catalog.json'),'utf8'));
 const {files}=await readSnippets(root);
 const names=new Set(files.map(item=>item.file));
 for(const file of ['plugin.config.json','.claude-plugin/plugin.json','.mcp.json','hooks/hooks.json','hooks/arkiv-rules.mjs','source/always-on.md','templates/AGENTS.snippet.md','evals/catalog.json'])names.add(file);
 for(const entry of catalog.cases)for(const file of ['prompt.md','graders/criteria.md','sources.json'])names.add(`evals/${entry.id}/${file}`);
 const sourceFiles=[];
 for(const file of [...names].sort()){
  const absolute=path.join(root,file);
  if(!(await lstat(absolute)).isFile())throw Error('Evaluation inputs must be regular files');
  sourceFiles.push({file,sha256:sha256(await readFile(absolute))});
 }
 return{version:1,capturedAt:new Date().toISOString(),sdk:config.sdkVersion,pluginVersion:config.version,sourceFiles};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const [output]=process.argv.slice(2);
  if(!output||!path.isAbsolute(output)||process.argv.length!==3)throw Error('Pass an absolute external input-manifest path');
  const relative=path.relative(repositoryRoot,output);
  if(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Evaluation evidence belongs outside the repository');
  const inputs=await evalInputs();await writeFile(output,JSON.stringify(inputs,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({result:'PASS',files:inputs.sourceFiles.length}));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
