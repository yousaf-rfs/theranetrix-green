import Link from 'next/link';
import {ArrowUpRight,ChevronDown} from 'lucide-react';
import type {Workspace} from '@/lib/theranetrix';

const stories=[
  {id:'TN-DEMO-01',label:'Treatment review',description:'Review reported grogginess and agree on the next treatment step.',links:[['Open visit','?tab=visit'],['Treatment','?tab=treatment']]},
  {id:'TN-DEMO-02',label:'Progress review',description:'Follow changes in pain and function, then review the ongoing plan.',links:[['Open visit','?tab=visit'],['Digital Twin','?tab=twin']]},
  {id:'TN-DEMO-03',label:'Connected care',description:'Enter a patient check-in and see it appear in the care record.',links:[['Patient companion','/patient-companion?patient=TN-DEMO-03'],['Open chart','?tab=visit']]},
];
export function PatientStories({workspace,busy,expanded=false}:{workspace:Workspace;busy:boolean;expanded?:boolean}){
  return <details className="sample-journeys" open={expanded||undefined}><summary><span><strong>Sample patient journeys</strong><small>Explore three connected care examples</small></span><ChevronDown size={17}/></summary><div className="sample-journeys-grid">{stories.map(story=>{const patient=workspace.patients.find(patient=>patient.id===story.id);return patient?<article key={story.id}><span className="sample-journey-label">{story.label}</span><h3>{patient.name}</h3><p>{story.description}</p><nav aria-label={patient.name+' story'}>{story.links.map(([label,suffix])=>busy?<span key={label}>{label}</span>:<Link key={label} href={suffix.startsWith('/')?suffix:'/patients/'+story.id+suffix}>{label}<ArrowUpRight size={13}/></Link>)}</nav></article>:null;})}</div></details>;
}
