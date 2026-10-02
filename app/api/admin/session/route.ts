import {sameOrigin,adminConfigured,adminCookie,adminSessionHeader,cookieHeader,isAdmin,setupAdmin,verifyAdmin} from '@/lib/invites';
import {allowLoginAttempt} from '@/lib/postgres-workspace';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',...headers}});

// The invite dashboard's own sign-in. The first visit sets the admin password; after that it is required.
export async function GET(request:Request){
  try{return json({configured:await adminConfigured(),signedIn:await isAdmin(request.headers)});}
  catch(error){console.error('Admin status failed',error);return json({error:'The invite dashboard is unavailable. Please try again.'},503);}
}
export async function POST(request:Request){
  if(!sameOrigin(request))return json({error:'Invalid request origin.'},403);
  try{
    const text=await request.text();if(text.length>2048)return json({error:'Invalid sign-in request.'},413);
    let body:{password?:unknown;setup?:unknown};try{body=JSON.parse(text);}catch{return json({error:'Invalid sign-in request.'},400);}
    if(typeof body?.password!=='string'||body.password.length>256)return json({error:'Enter the admin password.'},400);
    if(!await allowLoginAttempt(request))return json({error:'Too many sign-in attempts. Please try again in 15 minutes.'},429,{'Retry-After':'900'});
    if(body.setup===true){
      if(body.password.length<10)return json({error:'Use at least 10 characters.'},400);
      if(!await setupAdmin(body.password))return json({error:'An admin password is already set. Sign in with it.'},409);
    }else if(!await verifyAdmin(body.password))return json({error:'That password did not match. Please try again.'},401);
    return json({ok:true},200,{'Set-Cookie':await adminSessionHeader()});
  }catch(error){console.error('Admin sign-in failed',error);return json({error:'Sign-in is temporarily unavailable. Please try again.'},503);}
}
export async function DELETE(request:Request){
  if(!sameOrigin(request))return json({error:'Invalid request origin.'},403);
  return json({ok:true},200,{'Set-Cookie':cookieHeader(adminCookie,'',0)});
}
