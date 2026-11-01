import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const action = /\b(?:retr(?:y|ies|ied|ying)[\w-]*|re-?send(?:s|ing)?|re-?submi(?:t\w*|ssion\w*)|again|rebroadcast\w*)\b/i;
const normalize = text => text.replace(/\s+/g, ' ').trim();
const segmenter = new Intl.Segmenter('en', {granularity:'sentence'});
const canonicalPath = 'skills/arkiv-write-safety/SKILL.md';
const canonicalAnchor = '#reconcile-before-another-submission';
export const retryContract = 'Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy.';

// Exact, reviewed sentence forms distinguish prohibitions, read retries and
// diagnostics from transaction permissions. A nearby "never" or "reconcile"
// does not make other wording safe. New/changed sentences fail until classified.
// There are no guide-path exemptions or manually maintained guide catalogs.
const forms = new Map();
function sentences(category, values) {for(const text of values)forms.set(text,category);}
sentences('prohibition-or-reconciliation', [
 'A mismatch after confirmation needs reconciliation, never a blind resend.',
 'A readback or later save failure does not undo receipt confirmation or authorize resubmission.',
 'Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees.',
 'Validate the complete ordered result before publishing references; a post-confirmation mismatch requires repair, not resubmission.',
 'There is no automatic retry; preserve salts and reconcile identity first.',
 'Reconcile unknown outcomes under write-safety; a failed read/decrypt is not permission to create again.',
 'No automatic retry.', 'They do not retry.', 'The helpers do not retry.',
 'On a mismatch after confirmation retain the actual keys/hash and reconcile instead of resending.',
 'Follow [phase-aware recovery](../arkiv-troubleshooting/references/error-catalog.md) before retrying.',
 'If the result is still uncertain, preserve the draft and stop resubmission until resolved.',
 'This helper makes no automatic retry.',
 'An uncertain write goes directly to write-safety before any retry.',
 '| EntityMutationError | Preserve txHash if present; reconcile observed send phase and receipt before retrying |',
 'Store original hash/signed intent before formatting responses; fix verification without resubmission.',
 'A successful receipt followed by a decode/read failure must never be retried.',
 'These recovery helpers do not send or retry.',
 'SDK types also describe EIP-1559 fields; this guide retains them only to authenticate and reconcile already-signed intent, without rewriting or resending it.',
 'Stop automatic resubmission and authenticate signer/nonce/provider history.',
 "Repair this batch's verification or checkpoint without resending; block the next batch.",
 'Do not convert a transport retry policy into application retries around `createEntity()` or `executeBatch()`.',
 'The durable importer stops on every revert for operator reconciliation and never retries automatically.',
 'Restart with the original plan/hash/files, authenticate the known transaction and repair verification without resending it.',
 'Load durable state, authenticate every captured hash before continuing, repair incomplete verification, and skip resubmission of verified batches.',
 'The helper never rebroadcasts or retries.',
 'Journal-version-3 cases require receipt confirmation before reads, batch-local verification, and recovery without resubmission.',
 'Previously signed plans retain their original intent and must only be reconciled, never recalculated or resubmitted automatically.',
 'Existing signed fee intent is reconciled exactly as stored, without rewriting or resending it.',
 'If a crash happened between durable capture and provider admission, a missing receipt still requires operator reconciliation; an empty query is not permission to create again.',
 'Restart authenticates that original hash and repairs verification without resending.',
]);
sentences('read-only-or-transport', [
 'For a server-only reader, configure `createPublicClient({ chain: rabdi({ accessKey }), transport: http(), cacheTime: 0 })`, with no-store fetch options and bounded timeout/retries as described in the main recipe.',
 'The helper below fails unless every page is observed at the same unchanged head; use an exclusive writer/maintenance window and bound retries outside this helper.',
 'The checked viem transport retries `413` by default; use `retryCount: 0` for controlled size diagnostics.',
 'On `rate_limited`, wait `retryAfterSeconds`; do not retry at once.',
 'Preserve HTTP status and honor Retry-After; do not return empty results or loop through keys to bypass quota.',
 '| HTTP 429 | Stop and honor Retry-After; keyless access can reach the anonymous limit; preserve current key quota evidence |',
 'Honor actual Retry-After/reset policy; avoid retry storms or alternate-key quota bypass.',
 'RPC transport retries and submitting a new transaction are different actions.',
 'Supply a local account from your existing signer custody and a provider `request({ method, params })` configured without automatic retries.',
 'Keep provider request deadlines bounded and retries disabled in the supplied adapter too.',
 'Transport retry is not application idempotency.',
]);
sentences('idempotent-request-or-observation', [
 'Atomically bind `(actorId, operationId)` to the fingerprint, configured chain and signer; identical retries return the existing record.',
 'The client generates one operation ID before its first request, retains it across timeouts and retries, and displays the returned phase and any known key/hash.',
 'If creation times out or returns an ambiguous error, list recent issues directly with `gh issue list --repo Arkiv-Network/reported-issues --author @me --state all --limit 100 --json number,title,createdAt,body,url`; compare title, time and body before any retry.',
 'Discover the connected profile again before relying on these observations.',
 'Confirmed batches are authenticated again on restart.',
]);
sentences('security-warning', ['Keep the journal private: signed bytes can be rebroadcast by someone who obtains them, and calldata exposes the entity values.']);
const diagnostics = new Set([
 "function sanitizedFailure(error: unknown, fallback = 'Arkiv request failed; reconcile any admitted write before retrying'): Error & SafeDetails {",
 "if ((await reader.getTransactionReceipt({ hash: result.txHash })).status !== 'success') throw safeError('Receipt disagrees after SDK success; reconcile without resending');",
 "if (receipt.status !== 'success') throw safeError('Receipt disagrees after SDK success; reconcile without resending', { txHash: result.txHash });",
 "throw safeError('Confirmed batch prediction mismatch; reconcile without resending', { txHash: result.txHash });",
 "throw safeError('Confirmed write needs reconciliation; do not resend', { txHash: result.txHash, entityKey: result.entityKey, expiresAt: result.expiresAt });",
 "return safeError(message ?? 'Provider operation failed; reconcile durable intent before retrying');",
 'throw safeError("Stopped before durable send admission; inspect journal before retrying");',
]);
const disabledTransports = new Set([
 'const transport = http(undefined, { retryCount: 0, timeout: 10000,',
 '} }, { retryCount: 0 });',
 'const rpc = http(undefined, { retryCount: 0, timeout: 10000,',
 'transport: http(undefined, { timeout: 8000, retryCount: 0,',
 'return { read, reader: createPublicClient({ chain, cacheTime: 0, transport: custom({ request: read }, { retryCount: 0 }) }) };',
 'const wallet = createWalletClient({ account: unsignedAccount, chain, transport: custom({ request: read }, { retryCount: 0 }) });',
 'const wallet = createWalletClient({ account, chain, transport: custom({ request: guarded }, { retryCount: 0 }) });',
]);

// Discover by resource kind, never by a catalog of known guide paths.
export async function discoverRetryGuides(root) {
  const files=[];
  async function walk(directory) {
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      if(['.git','node_modules','.checks','.checks-surf'].includes(entry.name))continue;
      const absolute=path.join(directory,entry.name),file=path.relative(root,absolute).split(path.sep).join('/');
      if(entry.isSymbolicLink())throw new Error('Cannot certify a symlinked guide resource: '+file);
      if(entry.isDirectory())await walk(absolute);
      else if(/^SKILL\.md$/i.test(entry.name)||/^AGENTS(?:\.[\w-]+)*\.md$/i.test(entry.name)||file.split('/').includes('references'))files.push(file);
    }
  }
  await walk(root);return files.sort();
}

export function retrySentences(markdown) {
  const found=[];let fence,paragraph=[],start=1;
  function flush() {
    const context=paragraph.join('\n').replace(/^(?:\s*[-*+] |\s*\d+\. )/gm,'');
    for(const {segment,index} of segmenter.segment(context))if(action.test(segment))found.push({line:start+context.slice(0,index).split('\n').length-1,text:normalize(segment),context:normalize(context),kind:'prose'});
    paragraph=[];
  }
  markdown.split(/\r?\n/).forEach((line,index)=>{
    const delimiter=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if(delimiter) {flush();if(!fence)fence=delimiter;else if(delimiter[0]===fence[0]&&delimiter.length>=fence.length)fence=undefined;return;}
    if(fence){if(action.test(line))found.push({line:index+1,text:normalize(line),context:normalize(line),kind:'code'});return;}
    if(!line.trim()){flush();return;}
    if(!paragraph.length)start=index+1;
    paragraph.push(line);
  });flush();return found;
}

// Unknown wording fails closed. Classification rules describe sentences, not files.
// A permission must be the full canonical contract or an exact link to that contract.
export function classifyRetrySentence(sentence, file, canonicalValid) {
  const {text,context,kind}=sentence;
  if(kind==='prose'&&text===retryContract.split('. ')[0]+'.')return canonicalValid&&context.includes(retryContract)?'transaction-contract':'unsafe-transaction-permission';
  const delegation=/^Any transaction retry must satisfy every condition of the \[write-safety retry contract\]\(([^)]+)\); no other retry or resend is allowed\.$/.exec(text);
  if(delegation) {
    const [target,anchor]=delegation[1].split('#');
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),target));
    return canonicalValid&&resolved===canonicalPath&&'#'+anchor===canonicalAnchor?'transaction-contract-reference':'unsafe-contract-reference';
  }
  if(kind==='code')return diagnostics.has(text)?'fixed-diagnostic':disabledTransports.has(text)?'disabled-transport-retries':'unclassified-code';
  if(text==='Fix inputs, gas/funding, or persistence before retrying.')return context.includes('instrumented send admission was never reached')&&context.includes('No broadcast occurred through that guarded path.')?'unsigned-presend-preparation':'unsafe-transaction-permission';
  if(text==='Only authoritative gas exhaustion before any SDK success may qualify for the single bounded retry described below.')return canonicalValid&&file===canonicalPath?'transaction-contract-reference':'unsafe-contract-reference';
  if(forms.has(text))return forms.get(text);
  return 'unclassified';
}

export async function checkRetryPolicy(root) {
  const files=await discoverRetryGuides(root),contents=new Map();
  for(const file of files)contents.set(file,new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(path.join(root,file))));
  const canonical=contents.get(canonicalPath)??'';
  const canonicalValid=normalize(canonical).includes(retryContract)&&canonical.includes('## Reconcile before another submission');
  const inventory=[];
  for(const file of files)for(const sentence of retrySentences(contents.get(file)))inventory.push({file,...sentence,classification:classifyRetrySentence(sentence,file,canonicalValid)});
  const failures=inventory.filter(x=>/^(?:unsafe-|unclassified)/.test(x.classification));
  if(!canonicalValid)failures.push({file:canonicalPath,line:1,classification:'unsafe-canonical-contract',text:'The complete canonical retry contract and heading are required'});
  return {passed:failures.length===0,discoveredFiles:files.length,files,sentenceCount:inventory.length,inventory,failures};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const result=await checkRetryPolicy(root);
  const classes=Object.fromEntries([...new Set(result.inventory.map(x=>x.classification))].sort().map(name=>[name,result.inventory.filter(x=>x.classification===name).length]));
  console.log(JSON.stringify({...result,inventory:undefined,classes},null,2));if(!result.passed)process.exitCode=1;
}
