import type {Patient} from './theranetrix';

// Fictional identifiers for the fixed demo patients only. Every MRN carries a DEMO- prefix, and
// every date of birth uses the same made-up pattern (day equals month, February to June). Each
// matches the stored age for the whole demo period: records run July to September 2026 and every
// birthday falls earlier in the year, so no age changes during the demo or the rest of 2026.
export const demoIdentities:Record<string,{name:string;age:number;dateOfBirth:string;medicalRecordNumber:string}>={
  'TN-1042':{name:'Sarah Mitchell',age:54,dateOfBirth:'1972-02-02',medicalRecordNumber:'DEMO-000101'},
  'TN-1038':{name:'James Wilson',age:62,dateOfBirth:'1964-03-03',medicalRecordNumber:'DEMO-000102'},
  'TN-1051':{name:'Elena Rodriguez',age:47,dateOfBirth:'1979-04-04',medicalRecordNumber:'DEMO-000103'},
  'TN-1047':{name:'Robert Chen',age:68,dateOfBirth:'1958-05-05',medicalRecordNumber:'DEMO-000104'},
  'TN-1034':{name:'Olivia Bennett',age:39,dateOfBirth:'1987-06-06',medicalRecordNumber:'DEMO-000105'},
  'TN-1055':{name:'Michael Thompson',age:58,dateOfBirth:'1968-02-02',medicalRecordNumber:'DEMO-000106'},
  'TN-1031':{name:'Grace Park',age:45,dateOfBirth:'1981-03-03',medicalRecordNumber:'DEMO-000107'},
  'TN-1049':{name:'David Anderson',age:71,dateOfBirth:'1955-04-04',medicalRecordNumber:'DEMO-000108'},
  'TN-DEMO-01':{name:'Emma Carter',age:52,dateOfBirth:'1974-05-05',medicalRecordNumber:'DEMO-000109'},
  'TN-DEMO-02':{name:'Lucas Hayes',age:60,dateOfBirth:'1966-06-06',medicalRecordNumber:'DEMO-000110'},
  'TN-DEMO-03':{name:'Priya Raman',age:63,dateOfBirth:'1963-02-02',medicalRecordNumber:'DEMO-000111'},
};
export function demoIdentity(id:string):Pick<Patient,'dateOfBirth'|'medicalRecordNumber'>{
  const d=demoIdentities[id];return d?{dateOfBirth:d.dateOfBirth,medicalRecordNumber:d.medicalRecordNumber}:{};
}
// True while a demo patient still shows a seeded value, so the identifiers dialog can say it is fictional.
export function hasDemoIdentity(p:Pick<Patient,'id'|'dateOfBirth'|'medicalRecordNumber'>){
  const d=demoIdentities[p.id];return !!d&&(p.dateOfBirth===d.dateOfBirth||p.medicalRecordNumber===d.medicalRecordNumber);
}
// Saved workspaces created before the demo identifiers existed get them on read. Only a fixed demo
// patient that still has its seeded name and age and no recorded identity change is filled, and only
// in fields that are still empty. A value a clinician recorded or cleared is never replaced.
export function ensureDemoIdentities<W extends {patients:Patient[]}>(w:W):W{
  for(const p of w.patients){
    const d=demoIdentities[p.id];
    if(!d||p.name!==d.name||p.age!==d.age||p.identityHistory?.length)continue;
    if(p.dateOfBirth===undefined)p.dateOfBirth=d.dateOfBirth;
    if(p.medicalRecordNumber===undefined&&!w.patients.some(other=>other!==p&&other.medicalRecordNumber?.toLowerCase()===d.medicalRecordNumber.toLowerCase()))p.medicalRecordNumber=d.medicalRecordNumber;
  }
  return w;
}
