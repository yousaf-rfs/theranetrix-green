/** Bounded IDs retain the full source identity without changing existing projections. */
export function workflowBridgeId(kind:string,...parts:string[]){
  const input=JSON.stringify(parts);let first=2166136261,second=2246822507;
  for(let index=0;index<input.length;index++){first=Math.imul(first^input.charCodeAt(index),16777619);second=Math.imul(second^input.charCodeAt(index),3266489909);}
  return `wf-${kind}-${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
}
