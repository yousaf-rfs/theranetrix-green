'use client';
import {useId,useState,type ReactNode} from 'react';
import {CircleHelp,Plus,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cannotTakeReasons,emptyUnidentified,intakeCategories,medicationChoices,medicineForms,sideEffectOptions,triedOutcomes,type IntakeCategory,type MedicationReport,type TakingNow,type Unidentified,type YesNo} from '@/lib/patient-medication-report';
import type {Patient} from '@/lib/theranetrix';

const copy={
  en:{yes:'Yes',no:'No',unsure:'Not sure',remove:'Remove',add:'Add',addAnother:'Add another',more:'Show more',less:'Show fewer',typeName:'Not in the list? Type the name',fromRecord:'From your record',
    cannotTitle:'Is there any medicine you can’t take?',cannotHint:'For example, one that gave you an allergic reaction or a bad side effect, or one a doctor told you not to take.',cannotPick:'Tap any that apply',why:'Why can’t you take it?',happened:'What happened?',happenedHint:'For example, a rash or swelling',
    triedTitle:'Have you tried other medicines for this pain?',triedHint:'Include ones you stopped, even if it was a while ago.',triedPick:'Tap the ones you tried',helped:'Did it help?',effects:'Any side effects?',stopped:'Why did you stop?',stoppedHint:'For example, too sleepy, or it stopped working',
    nowTitle:'Taking anything that isn’t listed above?',nowHint:'Include medicines from other doctors, over-the-counter medicines, supplements, herbal products, and foods or drinks you have often. Share only what you want to.',nowName:'Medication name',productName:'Product name',foodName:'Food or drink',dose:'How much and how often, if you know',kind:'What kind is it? Optional',
    categories:{'sleep-anxiety':'Sleep or anxiety medicine',supplement:'Supplement or vitamin',herbal:'Herbal or CBD','food-drink':'Food or drink',other:'Other'},
    examples:{'sleep-anxiety':'sleep aids, anxiety medicines, muscle relaxants',supplement:'magnesium, melatonin, vitamin D',herbal:'turmeric, valerian, CBD','food-drink':'grapefruit juice, alcohol',other:''},
    suggestions:{'sleep-anxiety':[],supplement:['Magnesium','Melatonin','Vitamin D','Fish oil','Multivitamin'],herbal:['Turmeric','Valerian','St. John’s wort','CBD'],'food-drink':['Grapefruit juice','Alcohol'],other:[]},
    dontKnow:'I don’t know the name',unknownTitle:'Medicine, name not known',partialName:'Any part of the name you remember',unknownIntro:'Describe it as best you can. Your care team will work out which medicine it is.',
    form:'What form is it?',color:'Color',imprint:'Letters or numbers printed on it',usedFor:'What do you use it for?',usedForHint:'In your own words',source:'Who prescribed it, or which pharmacy',bringBottle:'Bring the bottle or a photo of the label to your visit.',
    forms:{Pill:'Pill',Capsule:'Capsule',Patch:'Patch','Cream or gel':'Cream or gel',Liquid:'Liquid',Injection:'Injection',Inhaler:'Inhaler'} as Record<string,string>,
    reasons:{'Allergic reaction':'Allergic reaction','Bad side effect':'Bad side effect','Told not to take it':'Told not to take it','Other':'Other'},
    outcomes:{'Helped':'Helped','Helped a little':'Helped a little','Did not help':'Did not help','Not sure':'Not sure'}},
  es:{yes:'Sí',no:'No',unsure:'No estoy seguro',remove:'Quitar',add:'Añadir',addAnother:'Añadir otro',more:'Ver más',less:'Ver menos',typeName:'¿No está en la lista? Escribe el nombre',fromRecord:'De tu registro',
    cannotTitle:'¿Hay algún medicamento que no puedas tomar?',cannotHint:'Por ejemplo, uno que te dio alergia o un efecto secundario fuerte, o uno que un médico te dijo que no tomaras.',cannotPick:'Toca los que correspondan',why:'¿Por qué no puedes tomarlo?',happened:'¿Qué pasó?',happenedHint:'Por ejemplo, sarpullido o hinchazón',
    triedTitle:'¿Has probado otros medicamentos para este dolor?',triedHint:'Incluye los que dejaste, aunque haya sido hace tiempo.',triedPick:'Toca los que probaste',helped:'¿Te ayudó?',effects:'¿Efectos secundarios?',stopped:'¿Por qué lo dejaste?',stoppedHint:'Por ejemplo, mucho sueño o dejó de funcionar',
    nowTitle:'¿Tomas algo que no aparece arriba?',nowHint:'Incluye medicamentos de otros médicos, medicamentos sin receta, suplementos, productos de hierbas y comidas o bebidas que tomas a menudo. Comparte solo lo que quieras.',nowName:'Nombre del medicamento',productName:'Nombre del producto',foodName:'Comida o bebida',dose:'Cuánto y cada cuánto, si lo sabes',kind:'¿Qué tipo es? Opcional',
    categories:{'sleep-anxiety':'Medicamento para dormir o la ansiedad',supplement:'Suplemento o vitamina',herbal:'Hierbas o CBD','food-drink':'Comida o bebida',other:'Otro'},
    examples:{'sleep-anxiety':'pastillas para dormir, medicamentos para la ansiedad, relajantes musculares',supplement:'magnesio, melatonina, vitamina D',herbal:'cúrcuma, valeriana, CBD','food-drink':'jugo de toronja, alcohol',other:''},
    suggestions:{'sleep-anxiety':[],supplement:['Magnesio','Melatonina','Vitamina D','Aceite de pescado','Multivitamínico'],herbal:['Cúrcuma','Valeriana','Hierba de San Juan','CBD'],'food-drink':['Jugo de toronja','Alcohol'],other:[]},
    dontKnow:'No sé el nombre',unknownTitle:'Medicamento sin nombre conocido',partialName:'Cualquier parte del nombre que recuerdes',unknownIntro:'Descríbelo lo mejor que puedas. Tu equipo averiguará qué medicamento es.',
    form:'¿Qué forma tiene?',color:'Color',imprint:'Letras o números impresos',usedFor:'¿Para qué lo usas?',usedForHint:'Con tus palabras',source:'Quién lo recetó o qué farmacia',bringBottle:'Trae el frasco o una foto de la etiqueta a tu visita.',
    forms:{Pill:'Pastilla',Capsule:'Cápsula',Patch:'Parche','Cream or gel':'Crema o gel',Liquid:'Líquido',Injection:'Inyección',Inhaler:'Inhalador'} as Record<string,string>,
    reasons:{'Allergic reaction':'Reacción alérgica','Bad side effect':'Efecto secundario fuerte','Told not to take it':'Me dijeron que no lo tomara','Other':'Otro'},
    outcomes:{'Helped':'Ayudó','Helped a little':'Ayudó un poco','Did not help':'No ayudó','Not sure':'No estoy seguro'}},
};
const effectLabels:Record<string,string>={'None':'Ninguno','Drowsy or groggy':'Sueño o aturdimiento','Dizzy':'Mareo','Upset stomach':'Malestar de estómago','Constipation':'Estreñimiento','Skin irritation':'Irritación de la piel','Weight gain':'Aumento de peso','Trouble thinking':'Dificultad para pensar','Other':'Otro'};
// A few undescribed medicines per question keep the combined check-in note within its limit.
const maxUnknown=3;

function Chips<T extends string>({label,options,selected,onToggle,disabled,render}:{label:string;options:readonly T[];selected:readonly T[];onToggle:(value:T)=>void;disabled:boolean;render?:(value:T)=>ReactNode}){
  return <div className="medq-chips" role="group" aria-label={label}>{options.map(option=><button type="button" key={option} className={selected.includes(option)?'selected':''} aria-pressed={selected.includes(option)} disabled={disabled} onClick={()=>onToggle(option)}>{render?render(option):option}</button>)}</div>;
}

function Picker({label,choices,fromRecord,chosen,onAdd,onRemove,onUnknown,disabled,t,listId}:{label:string;choices:string[];fromRecord:string[];chosen:string[];onAdd:(name:string)=>void;onRemove:(name:string)=>void;onUnknown?:()=>void;disabled:boolean;t:typeof copy['en'];listId:string}){
  const [typed,setTyped]=useState(''),[all,setAll]=useState(false);
  const shown=all?choices:choices.slice(0,8);
  const toggle=(name:string)=>chosen.includes(name)?onRemove(name):onAdd(name);
  const addTyped=()=>{const name=typed.trim();if(name&&!chosen.some(c=>c.toLowerCase()===name.toLowerCase()))onAdd(name);setTyped('');};
  return <div className="medq-picker">
    <span className="medq-label">{label}</span>
    <div className="medq-chips" role="group" aria-label={label}>{shown.map(name=><button type="button" key={name} className={chosen.includes(name)?'selected':''} aria-pressed={chosen.includes(name)} disabled={disabled} onClick={()=>toggle(name)}>{name}{fromRecord.includes(name)&&<small>{t.fromRecord}</small>}</button>)}
      {choices.length>8&&<button type="button" className="medq-more" disabled={disabled} onClick={()=>setAll(value=>!value)}>{all?t.less:t.more}</button>}</div>
    <div className="medq-type"><label className="sr-only" htmlFor={listId+'-input'}>{t.typeName}</label><Input id={listId+'-input'} list={listId} value={typed} maxLength={100} disabled={disabled} placeholder={t.typeName} autoComplete="off" onChange={e=>setTyped(e.target.value)} onBlur={addTyped} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addTyped();}}}/><Button type="button" variant="outline" size="sm" disabled={disabled||!typed.trim()} onClick={addTyped}><Plus size={14}/>{t.add}</Button>
      <datalist id={listId}>{choices.map(name=><option key={name} value={name}/>)}</datalist></div>
    {onUnknown&&<button type="button" className="medq-unknown-toggle" disabled={disabled} onClick={onUnknown}><CircleHelp size={15}/>{t.dontKnow}</button>}
  </div>;
}

function Answer({value,onChange,disabled,t,label}:{value:YesNo;onChange:(value:YesNo)=>void;disabled:boolean;t:typeof copy['en'];label:string}){
  return <div className="medq-answer" role="group" aria-label={label}>{(['yes','no','unsure'] as const).map(option=><button type="button" key={option} className={value===option?'selected':''} aria-pressed={value===option} disabled={disabled} onClick={()=>onChange(value===option?'':option)}>{t[option]}</button>)}</div>;
}

/** What the patient can tell us about a medicine they cannot name. Nothing is matched or suggested from it. */
function UnknownFields({value,onChange,disabled,t,label}:{value:Unidentified;onChange:(value:Unidentified)=>void;disabled:boolean;t:typeof copy['en'];label:string}){
  const field=(key:'color'|'imprint'|'usedFor'|'source',text:string,max:number,placeholder?:string)=><label className="medq-field">{text}<span className="sr-only"> {label}</span><Input value={value[key]} maxLength={max} disabled={disabled} placeholder={placeholder} autoComplete="off" onChange={e=>onChange({...value,[key]:e.target.value})}/></label>;
  return <div className="medq-unknown">
    <p className="medq-hint">{t.unknownIntro}</p>
    <span className="medq-label">{t.form}</span>
    <Chips label={t.form+' '+label} options={medicineForms} selected={value.form?[value.form]:[]} disabled={disabled} render={form=>t.forms[form]??form} onToggle={form=>onChange({...value,form:value.form===form?'':form})}/>
    <div className="medq-unknown-fields">{field('color',t.color,40)}{field('imprint',t.imprint,40)}{field('usedFor',t.usedFor,100,t.usedForHint)}{field('source',t.source,100)}</div>
    <p className="medq-reminder">{t.bringBottle}</p>
  </div>;
}

/** The medicine questions from the September meeting: what you can't take, what you tried and how it went. */
export function CompanionMedicationQuestions({p,report,onChange,disabled,lang='en'}:{p:Patient;report:MedicationReport;onChange:(report:MedicationReport)=>void;disabled:boolean;lang?:'en'|'es'}){
  const t=copy[lang],id=useId(),choices=medicationChoices(p),es=lang==='es';
  const set=(changes:Partial<MedicationReport>)=>onChange({...report,...changes});
  // Rows are plain fields so nothing typed is lost; empty rows are simply not reported.
  const nowRows:TakingNow[]=report.takingNow.length?report.takingNow:[{name:'',dose:'',category:''}];
  const setNow=(index:number,changes:Partial<TakingNow>)=>set({takingNow:nowRows.map((row,i)=>i===index?{...row,...changes}:row)});
  // A medicine without a name has no stable name to key by, so it is numbered in the order added.
  const unknownTitle=(rows:{unknown?:Unidentified}[],index:number)=>{const count=rows.filter(row=>row.unknown).length,position=rows.slice(0,index+1).filter(row=>row.unknown).length;return t.unknownTitle+(count>1?' '+position:'');};
  const title=(rows:{name:string;unknown?:Unidentified}[],index:number)=>rows[index].unknown?unknownTitle(rows,index):rows[index].name;
  const nameLabel=(category?:IntakeCategory|'')=>category==='food-drink'?t.foodName:category==='supplement'||category==='herbal'?t.productName:t.nowName;
  return <div className="medq">
    <fieldset className="medq-question">
      <legend>{t.cannotTitle}</legend><p className="medq-hint">{t.cannotHint}</p>
      <Answer label={t.cannotTitle} value={report.cannotTakeAnswer} onChange={value=>set({cannotTakeAnswer:value})} disabled={disabled} t={t}/>
      {report.cannotTakeAnswer==='yes'&&<>
        <Picker label={t.cannotPick} choices={choices.cannotTake} fromRecord={choices.fromRecord} chosen={report.cannotTake.map(row=>row.name)} disabled={disabled} t={t} listId={id+'-cannot'}
          onAdd={name=>set({cannotTake:[...report.cannotTake,{name,reason:'',details:''}]})} onRemove={name=>set({cannotTake:report.cannotTake.filter(row=>row.unknown||row.name!==name)})}
          onUnknown={report.cannotTake.filter(row=>row.unknown).length<maxUnknown?()=>set({cannotTake:[...report.cannotTake,{name:'',reason:'',details:'',unknown:emptyUnidentified()}]}):undefined}/>
        {report.cannotTake.map((row,index)=><div className="medq-card" key={row.unknown?'unknown-'+index:row.name}>
          <div className="medq-card-title"><strong>{title(report.cannotTake,index)}</strong><button type="button" aria-label={t.remove+' '+title(report.cannotTake,index)} disabled={disabled} onClick={()=>set({cannotTake:report.cannotTake.filter((_,i)=>i!==index)})}><X size={15}/></button></div>
          {row.unknown&&<UnknownFields value={row.unknown} label={title(report.cannotTake,index)} disabled={disabled} t={t} onChange={unknown=>set({cannotTake:report.cannotTake.map((r,i)=>i===index?{...r,unknown}:r)})}/>}
          <span className="medq-label">{t.why}</span>
          <Chips label={t.why+' '+title(report.cannotTake,index)} options={cannotTakeReasons} selected={row.reason?[row.reason]:[]} disabled={disabled} render={value=>t.reasons[value]} onToggle={value=>set({cannotTake:report.cannotTake.map((r,i)=>i===index?{...r,reason:r.reason===value?'':value}:r)})}/>
          <label className="medq-field">{t.happened}<Input value={row.details} maxLength={200} disabled={disabled} placeholder={t.happenedHint} onChange={e=>set({cannotTake:report.cannotTake.map((r,i)=>i===index?{...r,details:e.target.value}:r)})}/></label>
        </div>)}
      </>}
    </fieldset>
    <fieldset className="medq-question">
      <legend>{t.triedTitle}</legend><p className="medq-hint">{t.triedHint}</p>
      <Answer label={t.triedTitle} value={report.triedAnswer} onChange={value=>set({triedAnswer:value})} disabled={disabled} t={t}/>
      {report.triedAnswer==='yes'&&<>
        <Picker label={t.triedPick} choices={choices.tried} fromRecord={choices.fromRecord} chosen={report.tried.map(row=>row.name)} disabled={disabled} t={t} listId={id+'-tried'}
          onAdd={name=>set({tried:[...report.tried,{name,outcome:'',effects:[],stopped:''}]})} onRemove={name=>set({tried:report.tried.filter(row=>row.unknown||row.name!==name)})}
          onUnknown={report.tried.filter(row=>row.unknown).length<maxUnknown?()=>set({tried:[...report.tried,{name:'',outcome:'',effects:[],stopped:'',unknown:emptyUnidentified()}]}):undefined}/>
        {report.tried.map((row,index)=><div className="medq-card" key={row.unknown?'unknown-'+index:row.name}>
          <div className="medq-card-title"><strong>{title(report.tried,index)}</strong><button type="button" aria-label={t.remove+' '+title(report.tried,index)} disabled={disabled} onClick={()=>set({tried:report.tried.filter((_,i)=>i!==index)})}><X size={15}/></button></div>
          {row.unknown&&<UnknownFields value={row.unknown} label={title(report.tried,index)} disabled={disabled} t={t} onChange={unknown=>set({tried:report.tried.map((r,i)=>i===index?{...r,unknown}:r)})}/>}
          <span className="medq-label">{t.helped}</span>
          <Chips label={t.helped+' '+title(report.tried,index)} options={triedOutcomes} selected={row.outcome?[row.outcome]:[]} disabled={disabled} render={value=>t.outcomes[value]} onToggle={value=>set({tried:report.tried.map((r,i)=>i===index?{...r,outcome:r.outcome===value?'':value}:r)})}/>
          <span className="medq-label">{t.effects}</span>
          <Chips label={t.effects+' '+title(report.tried,index)} options={sideEffectOptions} selected={row.effects} disabled={disabled} render={value=>es?effectLabels[value]??value:value} onToggle={value=>set({tried:report.tried.map((r,i)=>{if(i!==index)return r;const on=r.effects.includes(value);const effects=value==='None'?(on?[]:['None']):on?r.effects.filter(e=>e!==value):[...r.effects.filter(e=>e!=='None'),value];return {...r,effects};})})}/>
          <label className="medq-field">{t.stopped}<Input value={row.stopped} maxLength={200} disabled={disabled} placeholder={t.stoppedHint} onChange={e=>set({tried:report.tried.map((r,i)=>i===index?{...r,stopped:e.target.value}:r)})}/></label>
        </div>)}
      </>}
    </fieldset>
    <fieldset className="medq-question">
      <legend>{t.nowTitle}</legend><p className="medq-hint">{t.nowHint}</p>
      {nowRows.map((row,index)=>{const rowLabel=nowRows.length>1?' '+(index+1):'',suggestions=row.category?t.suggestions[row.category]:[];return <div className="medq-now-row" key={index}>
        <span className="medq-label" aria-hidden="true">{t.kind}</span>
        <Chips label={t.kind+rowLabel} options={intakeCategories} selected={row.category?[row.category]:[]} disabled={disabled} render={category=><>{t.categories[category]}{t.examples[category]&&<small>{t.examples[category]}</small>}</>} onToggle={category=>setNow(index,{category:row.category===category?'':category})}/>
        <div className="medq-now">
          <label className="medq-field">{row.unknown?t.partialName:nameLabel(row.category)}{rowLabel&&<span className="sr-only">{rowLabel}</span>}<Input list={row.unknown||row.category==='sleep-anxiety'?undefined:suggestions.length?id+'-now-'+row.category:id+'-now'} value={row.name} maxLength={100} disabled={disabled} autoComplete="off" onChange={e=>setNow(index,{name:e.target.value})}/></label>
          <label className="medq-field">{t.dose}{rowLabel&&<span className="sr-only">{rowLabel}</span>}<Input value={row.dose} maxLength={150} disabled={disabled} onChange={e=>setNow(index,{dose:e.target.value})}/></label>
          {nowRows.length>1?<button type="button" className="medq-row-remove" aria-label={t.remove+' '+(row.name||(row.unknown?t.unknownTitle:t.nowName))+rowLabel} disabled={disabled} onClick={()=>set({takingNow:nowRows.filter((_,i)=>i!==index)})}><X size={15}/></button>:<span/>}
        </div>
        {/* One fixed label with a pressed state, so "pressed" always means "I don’t know the name". */}
        <button type="button" className="medq-unknown-toggle" aria-pressed={!!row.unknown} disabled={disabled} onClick={()=>setNow(index,{unknown:row.unknown?undefined:emptyUnidentified()})}><CircleHelp size={15}/>{t.dontKnow}</button>
        {row.unknown&&<UnknownFields value={row.unknown} label={t.unknownTitle+rowLabel} disabled={disabled} t={t} onChange={unknown=>setNow(index,{unknown})}/>}
      </div>;})}
      <Button type="button" variant="outline" size="sm" className="medq-add-row" disabled={disabled||nowRows.length>=5||!nowRows.at(-1)!.name.trim()&&!nowRows.at(-1)!.unknown} onClick={()=>set({takingNow:[...nowRows,{name:'',dose:'',category:''}]})}><Plus size={14}/>{t.addAnother}</Button>
      <datalist id={id+'-now'}>{choices.tried.map(name=><option key={name} value={name}/>)}</datalist>
      {intakeCategories.filter(category=>t.suggestions[category].length).map(category=><datalist key={category} id={id+'-now-'+category}>{t.suggestions[category].map(name=><option key={name} value={name}/>)}</datalist>)}
    </fieldset>
  </div>;
}
