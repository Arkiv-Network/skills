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
   const unwrap=node=>{while(node&&ts.isParenthesizedExpression(node))node=node.expression;return node;};
   const functionLike=node=>ts.isFunctionDeclaration(node)||ts.isFunctionExpression(node)||ts.isArrowFunction(node)||ts.isMethodDeclaration(node)||ts.isGetAccessorDeclaration(node)||ts.isSetAccessorDeclaration(node);
   function truth(node) {
    node=unwrap(node);
    if(node.kind===ts.SyntaxKind.TrueKeyword)return true;
    if(node.kind===ts.SyntaxKind.FalseKeyword||node.kind===ts.SyntaxKind.NullKeyword)return false;
    if(ts.isNumericLiteral(node))return Number(node.text)!==0;
    if(ts.isBigIntLiteral(node))return BigInt(node.text.slice(0,-1))!==0n;
    if(ts.isStringLiteral(node))return node.text.length>0;
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken){const value=truth(node.operand);return value===undefined?undefined:!value;}
    if(ts.isBinaryExpression(node)) {
     const left=truth(node.left),op=node.operatorToken.kind;
     if(op===ts.SyntaxKind.AmpersandAmpersandToken)return left===false?false:left===true?truth(node.right):undefined;
     if(op===ts.SyntaxKind.BarBarToken)return left===true?true:left===false?truth(node.right):undefined;
    }
   }
   const union=(...sets)=>new Set(sets.flatMap(set=>[...set]));
   function sequence(statements) {
    let result=new Set(['next']);
    for(const statement of statements)if(result.has('next')){result.delete('next');result=union(result,flow(statement));}
    return result;
   }
   function flow(statement) {
    if(ts.isReturnStatement(statement))return new Set(['return']);
    if(ts.isThrowStatement(statement))return new Set(['throw']);
    if(ts.isBreakStatement(statement))return new Set(['break']);
    if(ts.isContinueStatement(statement))return new Set(['continue']);
    if(ts.isBlock(statement))return sequence(statement.statements);
    if(ts.isIfStatement(statement)) {
     const value=truth(statement.expression),yes=flow(statement.thenStatement),no=statement.elseStatement?flow(statement.elseStatement):new Set(['next']);
     return value===true?yes:value===false?no:union(yes,no);
    }
    if(ts.isTryStatement(statement)) {
     let result=flow(statement.tryBlock);
     // Calls/property reads may throw even without an explicit ThrowStatement.
     // Include the handler conservatively rather than certify a hidden return.
     if(statement.catchClause){result.delete('throw');result=union(result,flow(statement.catchClause.block));}
     if(statement.finallyBlock){const final=flow(statement.finallyBlock);if(!final.has('next'))return final;final.delete('next');result=union(result,final);}
     return result;
    }
    if(ts.isForStatement(statement)||ts.isForOfStatement(statement)||ts.isForInStatement(statement)||ts.isWhileStatement(statement)||ts.isDoStatement(statement)) {
     const body=flow(statement.statement),value=ts.isForStatement(statement)&&!statement.condition?true:ts.isForStatement(statement)?truth(statement.condition):statement.expression&&!ts.isForOfStatement(statement)&&!ts.isForInStatement(statement)?truth(statement.expression):undefined;
     if(value===false&&!ts.isDoStatement(statement))return new Set(['next']);
     const result=union(body);result.delete('continue');result.delete('next');
     if(body.has('break')||(!ts.isDoStatement(statement)&&value!==true)||(ts.isDoStatement(statement)&&value!==true&&(body.has('next')||body.has('continue'))))result.add('next');result.delete('break');return result;
    }
    if(ts.isSwitchStatement(statement)) {
     const clauses=statement.caseBlock.clauses,result=new Set();
     for(let i=0;i<clauses.length;i++)for(const outcome of sequence(clauses.slice(i).flatMap(c=>[...c.statements])))result.add(outcome==='break'?'next':outcome);
     if(!clauses.some(c=>ts.isDefaultClause(c)))result.add('next');return result;
    }
    if(ts.isLabeledStatement(statement)||ts.isWithStatement(statement))return flow(statement.statement);
    // Definitions/callbacks are not executed by declaring them. In particular,
    // never mistake a nested function's return for a return from this guard.
    return new Set(['next']);
   }
   function reachable(node) {
    for(let child=node,parent=node.parent;parent;child=parent,parent=parent.parent) {
     if((ts.isBlock(parent)||ts.isSourceFile(parent))&&parent.statements.includes(child)) {
      const prefix=sequence(parent.statements.slice(0,parent.statements.indexOf(child)));
      if(!prefix.has('next')||prefix.has('return'))return false;
     }
     if(ts.isIfStatement(parent)) {
      const value=truth(parent.expression);
      if((child===parent.thenStatement&&value===false)||(child===parent.elseStatement&&value===true))return false;
     }
     if((ts.isWhileStatement(parent)||ts.isForStatement(parent))&&child===parent.statement) {
      const condition=ts.isForStatement(parent)?parent.condition:parent.expression;
      if(condition&&truth(condition)===false)return false;
     }
     if(functionLike(parent))return true;
    }
    return true;
   }
   function comparison(node,gasName,blockName,operator) {
    node=unwrap(node);if(!node||!ts.isBinaryExpression(node)||node.operatorToken.kind!==operator)return false;
    const left=unwrap(node.left),right=unwrap(node.right);
    if(!ts.isIdentifier(left)||left.text!==gasName||!ts.isBinaryExpression(right)||right.operatorToken.kind!==ts.SyntaxKind.SlashToken)return false;
    const limit=unwrap(right.left),divisor=unwrap(right.right);
    return ts.isPropertyAccessExpression(limit)&&!limit.questionDotToken&&ts.isIdentifier(limit.expression)&&limit.expression.text===blockName&&limit.name.text==='gasLimit'&&ts.isBigIntLiteral(divisor)&&divisor.text==='2n';
   }
   const throwsOnEveryPath=statement=>{const outcomes=flow(statement);return outcomes.size===1&&outcomes.has('throw');};
   function rejectsCaller(node) {
    // Start at the known rejecting branch/call, then follow its exceptional
    // completion outwards. A local throw is not proof if an enclosing handler
    // converts it to a normal completion or a finally block overrides it.
    let outcomes=new Set(['throw']);
    for(let child=node,parent=node.parent;parent;child=parent,parent=parent.parent) {
     if(functionLike(parent))return outcomes.size===1&&outcomes.has('throw');
     if(!ts.isTryStatement(parent))continue;
     if(child===parent.tryBlock&&parent.catchClause&&outcomes.has('throw')) {
      outcomes.delete('throw');outcomes=union(outcomes,flow(parent.catchClause.block));
     }
     if(parent.finallyBlock&&child!==parent.finallyBlock) {
      const final=flow(parent.finallyBlock);
      if(!final.has('next'))outcomes=final;
      else {final.delete('next');outcomes=union(outcomes,final);}
     }
    }
    return false;
   }
   function binds(binding,name) {
    if(ts.isIdentifier(binding))return binding.text===name;
    return (ts.isObjectBindingPattern(binding)||ts.isArrayBindingPattern(binding))&&binding.elements.some(e=>ts.isBindingElement(e)&&binds(e.name,name));
   }
   function functionAt(call) {
    if(!ts.isIdentifier(call.expression)||call.questionDotToken)return;
    const name=call.expression.text;
    for(let scope=call.parent;scope;scope=scope.parent) {
     if(functionLike(scope)&&scope.parameters.some(p=>binds(p.name,name)))return;
     if(!ts.isBlock(scope)&&!ts.isSourceFile(scope))continue;
     for(const statement of scope.statements) {
      if(ts.isFunctionDeclaration(statement)&&statement.name?.text===name)return stableBinding(scope,name,statement)?statement:undefined;
      if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(binds(declaration.name,name)) {
       if(!ts.isIdentifier(declaration.name))return;
       if(!(statement.declarationList.flags&ts.NodeFlags.Const)||!stableBinding(scope,name,declaration))return;
       if(declaration.pos>call.pos)return;
       const initializer=declaration.initializer&&unwrap(declaration.initializer);
       return initializer&&(ts.isArrowFunction(initializer)||ts.isFunctionExpression(initializer))?initializer:undefined;
      }
     }
    }
   }
   function stableBinding(scope,name,original) {
    let stable=true;
    const mentions=node=>{let found=false;visit(node,part=>{if(ts.isIdentifier(part)&&part.text===name)found=true;});return found;};
    visit(scope,node=>{
     if(node===original)return;
     if((ts.isVariableDeclaration(node)||ts.isParameter(node)||ts.isBindingElement(node))&&binds(node.name,name))stable=false;
     if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name?.text===name)stable=false;
     if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&mentions(node.left))stable=false;
     if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&mentions(node.operand))stable=false;
     if(ts.isDeleteExpression(node)&&mentions(node.expression))stable=false;
     if((ts.isForOfStatement(node)||ts.isForInStatement(node))&&mentions(node.initializer))stable=false;
     // Only declaration names and direct invocations preserve custody. Treat
     // aliases, arguments and property access as escapes. A direct invocation
     // inside a callback is still an invocation, not a transfer of the binding.
     if(ts.isIdentifier(node)&&node.text===name&&node!==original.name&&!(ts.isCallExpression(node.parent)&&node.parent.expression===node))stable=false;
    });
    return stable;
   }
   function executableAssertion(call,awaited) {
    const fn=functionAt(call);if(!fn?.body||!ts.isBlock(fn.body)||fn.asteriskToken||!fn.parameters.length||!ts.isIdentifier(fn.parameters[0].name))return false;
    if(fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)&&!awaited)return false;
    const parameter=fn.parameters[0].name.text;
    return fn.body.statements.some(statement=>{
     if(!ts.isIfStatement(statement)||!reachable(statement))return false;
     const predicate=unwrap(statement.expression);
     return ts.isPrefixUnaryExpression(predicate)&&predicate.operator===ts.SyntaxKind.ExclamationToken&&ts.isIdentifier(unwrap(predicate.operand))&&unwrap(predicate.operand).text===parameter&&throwsOnEveryPath(statement.thenStatement)&&rejectsCaller(statement);
    });
   }
   function blocked(block,gasName,after=-1) {
    if(!block||!ts.isBlock(block))return false;
    const statements=block.statements,reads=[];
    for(const statement of statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations) {
     if(d.pos<=after||!ts.isIdentifier(d.name)||!d.initializer||!ts.isAwaitExpression(d.initializer)||!reachable(statement))continue;
     const call=d.initializer.expression;
     if(ts.isCallExpression(call)&&!call.questionDotToken&&ts.isPropertyAccessExpression(call.expression)&&!call.expression.questionDotToken&&call.expression.name.text==='getBlock'&&call.arguments.some(arg=>ts.isObjectLiteralExpression(arg)&&arg.properties.some(p=>ts.isPropertyAssignment(p)&&(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name))&&p.name.text==='blockTag'&&ts.isStringLiteral(p.initializer)&&p.initializer.text==='latest')))reads.push(d);
    }
    for(const read of reads)for(const statement of statements) {
     if(statement.pos<read.end||!reachable(statement))continue;
     if(ts.isIfStatement(statement)&&comparison(statement.expression,gasName,read.name.text,ts.SyntaxKind.GreaterThanToken)&&throwsOnEveryPath(statement.thenStatement)&&rejectsCaller(statement))return {position:statement.end,kind:'direct'};
     if(ts.isExpressionStatement(statement)) {
      const awaited=ts.isAwaitExpression(statement.expression),call=awaited?statement.expression.expression:statement.expression;
      if(ts.isCallExpression(call)&&call.arguments.length&&comparison(call.arguments[0],gasName,read.name.text,ts.SyntaxKind.LessThanEqualsToken)&&executableAssertion(call,awaited)&&rejectsCaller(statement))return {position:statement.end,kind:'assertion'};
     }
    }
    return false;
   }
   function guardFor(declaration) {
    const block=declaration.parent.parent.parent,gas=declaration.name.getText(source);
    if(!ts.isBlock(block))return false;
    const direct=blocked(block,gas,declaration.end);if(direct)return direct;
    // Descend only through unconditional try bodies, never conditional branches
    // or handlers that run only after another error. Keep caller-side catch and
    // finally scopes visible when validating an awaited delegated guard.
    function callStatements(body) {
     return body.statements.flatMap(statement=>ts.isTryStatement(statement)?callStatements(statement.tryBlock):[statement]);
    }
    for(const statement of callStatements(block)) {
     if(statement.pos<declaration.end||!ts.isExpressionStatement(statement)||!reachable(statement))continue;
     const expression=ts.isAwaitExpression(statement.expression)?statement.expression.expression:statement.expression;
     if(!ts.isCallExpression(expression)||expression.questionDotToken||!expression.arguments.some(x=>x.getText(source)===gas))continue;
     const target=functionAt(expression);
     if(target&&target.parameters.length===expression.arguments.length) {
      if(target.modifiers?.some(x=>x.kind===ts.SyntaxKind.AsyncKeyword)&&!ts.isAwaitExpression(statement.expression))continue;
      const index=expression.arguments.findIndex(x=>x.getText(source)===gas),checked=blocked(target.body,target.parameters[index].name.getText(source));
      if(checked&&rejectsCaller(statement))return {position:statement.end,kind:'checked-delegation',target:expression.expression.getText(source)};
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
   for(const [name,fn] of functions)if(fn.parameters.some(p=>ts.isIdentifier(p.name)&&p.name.text==='gas')&&fn.body?.getText(source).includes('.getBlock('))inventory.push({file,function:name,kind:'delegated-guard',guarded:Boolean(blocked(fn.body,'gas'))});
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

// The static inspector is a unit-testable second layer. The repository gate
// also requires every discovered point to pass its exact-body execution probe.
export async function verifyGasBounds(root,workspace) {
 const structural=await inspectGasBounds(root,workspace);
 const {executeGasBounds}=await import('./gas-bound-execution.mjs');
 const behavioral=await executeGasBounds(root,workspace,structural.inventory);
 return {...structural,staticPassed:structural.passed,behavioral,passed:structural.passed&&behavioral.passed};
}
