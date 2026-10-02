export type WorkflowNavigation<T extends string>={route?:T;selected?:T;opened?:boolean;visited:T[]};

export const workflowOpenEvent='theranetrix:open-workflow';

/** A launch button can reopen a domain even when its URL is already selected. */
export function openWorkflow(domain:string):void{
  if(typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent(workflowOpenEvent,{detail:{domain}}));
}

export function workflowOpenDomain<T extends string>(event:Event,available:readonly T[]):T|undefined{
  if(!(event instanceof CustomEvent)||!event.detail||typeof event.detail!=='object')return undefined;
  const domain=(event.detail as {domain?:unknown}).domain;
  return available.find(candidate=>candidate===domain);
}

/** Removing a screen guide must not discard the workflow that it opened. */
export function reconcileWorkflowRoute<T extends string>(state:WorkflowNavigation<T>,requested:T|undefined):WorkflowNavigation<T>{
  if(state.route===requested)return state;
  if(!requested)return {...state,route:undefined};
  return {...state,route:requested,selected:requested,opened:true,visited:[...new Set([...state.visited,requested])]};
}

export function selectWorkflow<T extends string>(state:WorkflowNavigation<T>,selected:T):WorkflowNavigation<T>{
  return {...state,selected,opened:true,visited:[...new Set([...state.visited,selected])]};
}

/** Record views exit the guided screen sequence while retaining an open workflow. */
export function patientRecordViewSearch(search:string,tab:string):string{
  const params=new URLSearchParams(search);
  for(const key of ['journey','journeyStop','journeyPatient'])params.delete(key);
  params.set('tab',tab);
  return '?'+params.toString();
}

/** Focus the destination itself after opening every enclosing disclosure.
 * Headings carry the journey id in `data-journey`, so the internal code never needs to appear in visible text. */
export function focusWorkflowJourney(root:HTMLElement,journeyId:string):boolean{
  if(!/^J\d{2}$/.test(journeyId))return false;
  const headings=Array.from(root.querySelectorAll<HTMLElement>('summary,h2,h3,legend'));
  const heading=headings.find(element=>element.getAttribute('data-journey')===journeyId)??headings.find(element=>new RegExp('^'+journeyId+'(?:\\s|$)').test(element.textContent?.trim()??''));
  if(!heading)return false;
  for(let disclosure=heading.closest('details');disclosure&&root.contains(disclosure);disclosure=disclosure.parentElement?.closest('details')??null)disclosure.open=true;
  if(heading.tagName!=='SUMMARY')heading.setAttribute('tabindex','-1');
  heading.focus({preventScroll:true});
  heading.scrollIntoView({block:'start'});
  return true;
}
