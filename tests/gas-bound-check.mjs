import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {discoverRetryGuides} from '../scripts/check-retry-policy.mjs';

// Inspect executable ASTs, not prose, comments or a catalog of guide paths.
export async function inspectGasBounds(root,workspace) {
 const {default:ts}=await import(pathToFileURL(path.join(workspace,'node_modules/typescript/lib/typescript.js')));
 const inventory=[];
 for(const file of await discoverRetryGuides(root)) {
  const text=await fs.readFile(path.join(root,file),'utf8');
  for(const fence of text.matchAll(/```(?:typescript|javascript)\r?\n([\s\S]*?)\r?\n```/g)) {
   const source=ts.createSourceFile(file+'.ts',fence[1],ts.ScriptTarget.Latest,true),functions=new Map();
   const visit=(node,callback)=>{callback(node);ts.forEachChild(node,child=>visit(child,callback));};
   visit(source,node=>{if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node);});
   const code=node=>node.getText(source).replace(/\s+/g,'');
   const ownFunction=node=>{for(let p=node.parent;p;p=p.parent)if(ts.isFunctionDeclaration(p))return p.name.text;};
   function blocked(block,gasName,after=-1) {
    if(!block||!ts.isBlock(block))return false;
    const statements=block.statements,reads=[];
    for(const statement of statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations) {
     if(d.pos<=after||!d.initializer||!ts.isAwaitExpression(d.initializer))continue;
     const call=d.initializer.expression;
     if(ts.isCallExpression(call)&&ts.isPropertyAccessExpression(call.expression)&&call.expression.name.text==='getBlock'&&call.arguments.some(arg=>ts.isObjectLiteralExpression(arg)&&arg.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='blockTag'&&ts.isStringLiteral(p.initializer)&&p.initializer.text==='latest')))reads.push(d);
    }
    for(const read of reads)for(const statement of statements) {
     if(statement.pos<read.end)continue;
     const half=read.name.getText(source)+'.gasLimit/2n';
     if(ts.isIfStatement(statement)&&code(statement.expression)===gasName+'>'+half&&ts.isThrowStatement(statement.thenStatement))return {position:statement.end,kind:'direct'};
     if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)) {
      const call=statement.expression,checkFn=call.expression.getText(source);
      if(checkFn!=='check'||!call.arguments.length||code(call.arguments[0])!==gasName+'<='+half)continue;
      // This boolean assertion must really throw on false; a same-name stub is insufficient.
      const assertion=source.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(source)==='check'));
      if(assertion&&/if\(!ok\)throwsafeError\(why\)/.test(code(assertion)))return {position:statement.end,kind:'assertion'};
     }
    }
    return false;
   }
   function guardFor(declaration) {
    const block=declaration.parent.parent.parent,gas=declaration.name.getText(source);
    if(!ts.isBlock(block))return false;
    const direct=blocked(block,gas,declaration.end);if(direct)return direct;
    for(const statement of block.statements) {
     if(statement.pos<declaration.end||!ts.isExpressionStatement(statement))continue;
     const expression=ts.isAwaitExpression(statement.expression)?statement.expression.expression:statement.expression;
     if(!ts.isCallExpression(expression)||!expression.arguments.some(x=>x.getText(source)===gas))continue;
     const target=functions.get(expression.expression.getText(source));
     if(target&&target.parameters.length===expression.arguments.length) {
      if(target.modifiers?.some(x=>x.kind===ts.SyntaxKind.AsyncKeyword)&&!ts.isAwaitExpression(statement.expression))continue;
      const index=expression.arguments.findIndex(x=>x.getText(source)===gas),checked=blocked(target.body,target.parameters[index].name.getText(source));
      if(checked)return {position:statement.end,kind:'checked-delegation',target:target.name.text};
     }
    }
    return false;
   }
   const computed=[];
   visit(source,node=>{
    if(!ts.isVariableDeclaration(node)||!node.initializer)return;
    const value=node.initializer.getText(source),name=node.name.getText(source),fn=functions.get(ownFunction(node));
    let estimateValue=false,doubled=false;
    function ownExpression(part) {
     // A callback's arithmetic belongs to that callback, not its transport/client initializer.
     if(ts.isArrowFunction(part)||ts.isFunctionExpression(part)||ts.isMethodDeclaration(part)||ts.isFunctionDeclaration(part))return;
     if(ts.isIdentifier(part)&&/estimate/i.test(part.text))estimateValue=true;
     if(ts.isBinaryExpression(part)&&part.operatorToken.kind===ts.SyntaxKind.AsteriskToken&&[part.left,part.right].some(x=>ts.isBigIntLiteral(x)&&x.text==='2n'))doubled=true;
     ts.forEachChild(part,ownExpression);
    }
    ownExpression(node.initializer);
    const calculated=estimateValue&&(/gas/i.test(name)||doubled);
    const frozen=/^gas$/i.test(name)&&/BigInt\(batch\.gas\)/.test(value)&&fn?.body?.getText(source).includes('estimateGas');
    if(calculated||frozen)computed.push(node);
   });
   // Pure arithmetic is not a send boundary: callers choosing a cap guard it.
   for(const [name,fn] of functions)if(fn.body&&fn.parameters.some(x=>x.name.getText(source)==='estimate')&&!computed.some(d=>ownFunction(d)===name)&&/estimate\*2n/.test(code(fn.body))) {
    const sites=computed.filter(d=>ts.isCallExpression(d.initializer)&&d.initializer.expression.getText(source)===name);
    inventory.push({file,function:name,line:text.slice(0,fence.index).split('\n').length+source.getLineAndCharacterOfPosition(fn.getStart(source)).line+1,kind:'pure-formula',guarded:sites.length>0&&sites.every(d=>Boolean(guardFor(d)))});
   }
   for(const declaration of computed) {
    const guard=guardFor(declaration),block=declaration.parent.parent.parent;
    // A guard after a return or funded wallet entry cannot protect that operation.
    let earlySink=false;
    if(guard)for(const statement of block.statements)if(statement.pos>=declaration.end&&statement.pos<guard.position&&statement.end!==guard.position) {
     visit(statement,node=>{if(ts.isReturnStatement(node)||(ts.isCallExpression(node)&&/wallet\.(?:createEntity|executeBatch|patchEntity|extendEntity|changeOwnership|deleteEntity)/.test(node.expression.getText(source))))earlySink=true;});
    }
    inventory.push({file,function:ownFunction(declaration),line:text.slice(0,fence.index).split('\n').length+source.getLineAndCharacterOfPosition(declaration.getStart(source)).line+1,variable:declaration.name.getText(source),kind:guard?.kind??'missing',guarded:Boolean(guard)&&!earlySink});
   }
   // The unsigned estimator returns an estimate, but must reject an impossible padded cap.
   for(const [name,fn] of functions)if(fn.body&&fn.body.getText(source).includes("'eth_estimateGas'")&&fn.body.getText(source).includes('Unsigned estimate captured')&&!computed.some(d=>ownFunction(d)===name))inventory.push({file,function:name,kind:'unsigned-estimator-missing',guarded:false});
  }
 }
 return {passed:inventory.every(x=>x.guarded),inventory,failures:inventory.filter(x=>!x.guarded)};
}
