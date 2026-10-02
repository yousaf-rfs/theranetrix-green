'use client';

import {bodyRegionName} from '@/lib/patient-checkin-note';

// `label` is the saved value (English, read by the clinician record); Spanish-speaking patients see its Spanish name.
const regions=[
  {id:'head',label:'Head',x:42,y:4},
  {id:'neck',label:'Neck',x:42,y:14},
  {id:'chest-right',label:'Right chest',x:28,y:26},
  {id:'chest-left',label:'Left chest',x:56,y:26},
  {id:'abdomen',label:'Abdomen',x:42,y:40},
  {id:'arm-right',label:'Right arm',x:12,y:32},
  {id:'arm-left',label:'Left arm',x:72,y:32},
  {id:'hand-right',label:'Right hand',x:8,y:48},
  {id:'hand-left',label:'Left hand',x:76,y:48},
  {id:'low-back',label:'Low back',x:42,y:52},
  {id:'thigh-right',label:'Right thigh',x:30,y:64},
  {id:'thigh-left',label:'Left thigh',x:54,y:64},
  {id:'foot-right',label:'Right foot',x:30,y:88},
  {id:'foot-left',label:'Left foot',x:54,y:88},
  {id:'widespread',label:'Widespread',x:42,y:96},
];

export function BodyMap({value,onChange,lang='en'}:{value:string;onChange:(v:string)=>void;lang?:'en'|'es'}){
  return <div className="body-map">
    <p>{lang==='es'?'¿Dónde sientes el dolor hoy?':'Where do you feel pain today?'}</p>
    <div className="body-map-layout">
      <svg viewBox="0 0 100 108" className="body-map-svg" role="img" aria-label={lang==='es'?'Mapa corporal':'Body map'}>
        <ellipse cx="50" cy="10" rx="8" ry="9" fill="#d7e4dc"/>
        <rect x="46" y="18" width="8" height="6" rx="2" fill="#d7e4dc"/>
        <rect x="38" y="24" width="24" height="28" rx="8" fill="#d7e4dc"/>
        <rect x="22" y="26" width="14" height="28" rx="6" fill="#d7e4dc"/>
        <rect x="64" y="26" width="14" height="28" rx="6" fill="#d7e4dc"/>
        <rect x="40" y="50" width="20" height="28" rx="7" fill="#d7e4dc"/>
        <rect x="36" y="76" width="10" height="22" rx="5" fill="#d7e4dc"/>
        <rect x="54" y="76" width="10" height="22" rx="5" fill="#d7e4dc"/>
        {regions.filter(r=>r.id!=='widespread').map(r=>{
          const selected=value===r.label;
          return <circle key={r.id} cx={r.x+8} cy={r.y+2} r={selected?6:4.5} fill={selected?'#c45c5c':'#7aa08b'} stroke="#fff" strokeWidth="1.2" className="body-map-dot" role="button" tabIndex={0} aria-label={bodyRegionName(r.label,lang)} aria-pressed={selected} onClick={()=>onChange(selected?'':r.label)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onChange(selected?'':r.label);}}}/>;
        })}
      </svg>
      <div className="body-map-keys">{regions.map(r=><button type="button" key={r.id} className={value===r.label?'selected':''} aria-pressed={value===r.label} onClick={()=>onChange(value===r.label?'':r.label)}>{bodyRegionName(r.label,lang)}</button>)}</div>
    </div>
  </div>;
}
