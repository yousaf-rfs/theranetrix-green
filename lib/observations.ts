import {featureEnabled,type Patient,type Workspace} from './theranetrix';

// Observed outcomes belong to assessments and do not depend on either simulator.
export function observedMetrics(p:Patient,w:Workspace){
  return featureEnabled(w,'assessments')?(['pain','function','sleep'] as const).map(key=>{
    const values=p[key],first=values[0],last=values.at(-1),previous=values.at(-2);
    return {key,first,last,previous,delta:values.length>1?last!-first:null,recent:values.length>1?last!-previous!:null,count:values.length};
  }):[];
}

// Recover source rows from already stored trajectories without inventing notes or times.
export function ensureObservationRecords(w:Workspace){
  for(const p of w.patients){
    const counts=new Map<string,number>();
    const key=(date:string,pain:number,fn:number,sleep:number)=>[date.slice(0,10),pain,fn,sleep].join('|');
    for(const c of p.checkins){const k=key(c.date,c.pain,c.function,c.sleep);counts.set(k,(counts.get(k)??0)+1);}
    p.dates.forEach((date,i)=>{
      const pain=p.pain[i],fn=p.function[i],sleep=p.sleep[i];
      if(!date||![pain,fn,sleep].every(v=>Number.isFinite(v)))return;
      const k=key(date,pain,fn,sleep),count=counts.get(k)??0;
      if(count){counts.set(k,count-1);return;}
      const id='trajectory-'+p.id+'-'+i;
      if(!p.checkins.some(c=>c.id===id))p.checkins.push({id,date:date.slice(0,10),pain,function:fn,sleep,note:'',source:'Stored trajectory'});
    });
    p.checkins.sort((a,b)=>b.date.localeCompare(a.date));
  }
  return w;
}
