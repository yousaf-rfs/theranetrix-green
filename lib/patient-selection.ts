/** An explicit unavailable chart must never silently select somebody else. */
export function selectedPatient<T extends {id:string}>(patients:readonly T[],requested:string|null,choice?:string):T|undefined{
  const id=choice??requested;
  return id===null||id===undefined?patients[0]:patients.find(patient=>patient.id===id);
}
