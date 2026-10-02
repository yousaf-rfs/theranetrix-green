'use client';
import {useState} from 'react';
import {Printer} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {visitDocumentHtml} from '@/lib/visit-document';
import type {Patient,Workspace} from '@/lib/theranetrix';

export function VisitDocument({patient,workspace}:{patient:Patient;workspace:Workspace}){
  const [error,setError]=useState('');
  function print(){
    setError('');const doc=window.open('','_blank');
    if(!doc){setError('Allow the visit-summary window, then try again.');return;}
    doc.opener=null;doc.document.open();doc.document.write(visitDocumentHtml(patient,workspace));doc.document.close();
    doc.addEventListener('load',()=>{doc.focus();doc.print();},{once:true});
  }
  return <div className="visit-document-control"><Button variant="outline" onClick={print} title="Open the current visit summary to print or save as a PDF"><Printer size={15}/><span>Visit PDF</span></Button>{error&&<small role="alert">{error}</small>}</div>;
}
