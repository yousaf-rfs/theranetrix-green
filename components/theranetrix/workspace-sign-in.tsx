'use client';
import {useState,type FormEvent} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export function WorkspaceSignIn({onSuccess}:{onSuccess:()=>Promise<void>}){
  const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');
    try{const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error??'Sign-in failed.');setPassword('');await onSuccess();}
    catch(e){setError(e instanceof Error?e.message:'Sign-in failed. Please try again.');}finally{setBusy(false);}
  }
  return <form onSubmit={submit} style={{maxWidth:'24rem',margin:'1.2rem auto',display:'grid',gap:'.8rem',textAlign:'left'}}><label htmlFor="workspace-password">Access code</label><Input id="workspace-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/>{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={busy||!password}>{busy?'Unlocking…':'Unlock workspace'}</Button></form>;
}
