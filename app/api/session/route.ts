import {configured,passwordRequired,verifyPassword,issueSession,sessionHeader,sameOrigin} from '@/lib/vercel-session';
import {allowLoginAttempt} from '@/lib/postgres-workspace';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',...headers}});
export async function POST(request:Request){
  if(!sameOrigin(request))return json({error:'Invalid request origin.'},403);
  if(!passwordRequired())return json({ok:true,accessMode:'shared'},200,{'Set-Cookie':sessionHeader('')});
  if(!configured())return json({error:'Private access is not configured yet. The workspace owner needs to finish deployment setup.'},503);
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON required.'},415);
  try{
    const text=await request.text();if(text.length>2048)return json({error:'Invalid sign-in request.'},413);
    let body;try{body=JSON.parse(text);}catch{return json({error:'Invalid sign-in request.'},400);}
    if(typeof body?.password!=='string'||body.password.length>256)return json({error:'Enter your workspace password.'},400);
    if(!await allowLoginAttempt(request))return json({error:'Too many sign-in attempts. Please try again in 15 minutes.'},429,{'Retry-After':'900'});
    if(!verifyPassword(body.password))return json({error:'That password did not match. Please try again.'},401);
    return json({ok:true},200,{'Set-Cookie':sessionHeader(issueSession())});
  }catch{return json({error:'Sign-in is temporarily unavailable. Please try again.'},503);}
}
export async function DELETE(request:Request){
  if(!sameOrigin(request))return json({error:'Invalid request origin.'},403);
  return json({ok:true},200,{'Set-Cookie':sessionHeader('')});
}
