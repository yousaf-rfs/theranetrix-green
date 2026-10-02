import {inviteForLink,openInvite} from '@/lib/invites';
export const runtime='nodejs';
export const dynamic='force-dynamic';

// A personal invite link: signs this browser in as the invited person and opens where their invite points.
const page=(title:string,body:string,status:number)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · TheraNetrix</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7f8;color:#17313f;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:26rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #d8e2e6;border-radius:12px}h1{margin:0 0 .5rem;font-size:1.25rem}p{margin:0;color:#3d5563}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});

export async function GET(request:Request,{params}:{params:Promise<{token:string}>}){
  try{
    const {token}=await params,invite=await inviteForLink(token);
    if(!invite)return page('This link is not active','It may have been replaced with a new link or turned off. Ask the person who sent it for a current link.',404);
    const cookie=await openInvite(invite);
    return new Response(null,{status:303,headers:{Location:new URL(invite.role==='patient'?'/patient-companion':'/',request.url).toString(),'Set-Cookie':cookie,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
  }catch(error){console.error('Invite link failed',error);return page('This link could not open','Please try again in a moment.',503);}
}
