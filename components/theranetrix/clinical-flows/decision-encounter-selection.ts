export type DecisionEditorStatus={dirty:boolean;pending:boolean;busy:boolean};
export type DecisionEncounterSelection={encounterId:string;proposedId:string;requestedId:string|null;editor:DecisionEditorStatus};
export type DecisionEncounterSelectionAction=
  |{type:'stage';value:string}
  |{type:'editor';status:DecisionEditorStatus}
  |{type:'request'|'cancel'|'discard'};

export function initialDecisionEncounterSelection(encounterId:string):DecisionEncounterSelection{
  return {encounterId,proposedId:encounterId,requestedId:null,editor:{dirty:false,pending:false,busy:false}};
}

/** Typing never changes the active chart scope or disposes its editor state. */
export function decisionEncounterSelection(state:DecisionEncounterSelection,action:DecisionEncounterSelectionAction):DecisionEncounterSelection{
  if(action.type==='stage')return {...state,proposedId:action.value,requestedId:null};
  if(action.type==='editor')return Object.keys(action.status).every(key=>action.status[key as keyof DecisionEditorStatus]===state.editor[key as keyof DecisionEditorStatus])?state:{...state,editor:action.status};
  if(action.type==='cancel')return {...state,requestedId:null};
  if(state.editor.busy)return state;
  const next=action.type==='discard'?state.requestedId:state.proposedId.trim();
  if(!next||next===state.encounterId)return state;
  if(action.type==='request'&&(state.editor.dirty||state.editor.pending))return {...state,requestedId:next};
  return initialDecisionEncounterSelection(next);
}
