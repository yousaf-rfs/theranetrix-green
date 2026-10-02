'use client';
import {useSyncExternalStore} from 'react';
const subscribe=(listener:()=>void)=>{window.addEventListener('popstate',listener);window.addEventListener('hashchange',listener);return ()=>{window.removeEventListener('popstate',listener);window.removeEventListener('hashchange',listener);};};
const client=()=>window.location.search;
const server=()=>'';
export function useLocationParameter(name:string){return new URLSearchParams(useSyncExternalStore(subscribe,client,server)).get(name);}

const clientHash=()=>window.location.hash;
export function useLocationHash(){return useSyncExternalStore(subscribe,clientHash,server);}
