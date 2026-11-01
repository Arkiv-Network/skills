// Provider errors can embed URL-path credentials in any field or nested cause.
// This boundary deliberately reads no property of the untrusted error.
const messages=new Map([
 ['seed','Seed stopped; inspect private durable state without resubmitting'],
 ['lifetime','Lifetime probe stopped; reconcile its private journal before any new write'],
 ['live','Live Rabdi check failed; inspect operation state without automatic resubmission'],
]);
export function safeProviderError(_error,stage){
 const error=new Error(messages.get(stage)??'Arkiv operation failed; inspect operation state');
 error.name='ArkivOperationError';
 return error;
}
export function safeProviderDiagnostic(error,stage){
 const safe=safeProviderError(error,stage);
 return {errorName:'ArkivOperationError',message:safe.message};
}
