'use client';
import {useState} from 'react';
import {RotateCcw,Undo2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import type {Context} from './app';
import {formatDate} from './ui';

/** Top-bar Undo: steps the shared workspace back one saved change, after confirmation. */
export function UndoControl({ctx}:{ctx:Context}){
  const [open,setOpen]=useState(false);
  const undo=ctx.undo;
  if(!undo||!ctx.undoLast)return null;
  return <>
    <Button variant="outline" size="sm" className="workspace-undo-trigger" disabled={ctx.busy} onClick={()=>setOpen(true)} aria-label={'Undo last change: '+undo.label} title={'Undo: '+undo.label}><Undo2 size={15}/><span className="workspace-undo-label">Undo</span></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="workspace-control-dialog">
      <DialogHeader><DialogTitle>Undo the last change?</DialogTitle><DialogDescription>The workspace goes back to how it was just before this change. Everyone using this shared workspace sees the result.</DialogDescription></DialogHeader>
      <div className="workspace-control-change"><strong>{undo.label}</strong><span>{undo.actor} · {formatDate(undo.savedAt,true)}</span></div>
      <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={ctx.busy} onClick={async()=>{if(await ctx.undoLast!())setOpen(false);}}><Undo2 size={15}/>{ctx.busy?'Undoing…':'Undo change'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

/** Settings: restore the original demonstration records. The reset itself can be undone. */
export function ResetDemoControl({ctx}:{ctx:Context}){
  const [open,setOpen]=useState(false);
  if(!ctx.resetDemo)return null;
  return <>
    <Button variant="outline" disabled={ctx.busy} onClick={()=>setOpen(true)}><RotateCcw size={16}/>Reset demo data</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="workspace-control-dialog">
      <DialogHeader><DialogTitle>Reset the demo data?</DialogTitle><DialogDescription>Every patient, check-in, decision, note, message and setting returns to the original demonstration records. Everyone using this shared workspace sees the reset.</DialogDescription></DialogHeader>
      <p className="workspace-control-note">Changed your mind afterwards? Use Undo at the top of the page to bring back the workspace as it was before the reset.</p>
      <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button variant="destructive" disabled={ctx.busy} onClick={async()=>{if(await ctx.resetDemo!())setOpen(false);}}><RotateCcw size={15}/>{ctx.busy?'Resetting…':'Reset demo data'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
