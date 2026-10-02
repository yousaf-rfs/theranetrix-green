import {sameOrigin,parsePeople,createInvite,getInvite,invitePath,isAdmin,listInvites,parseInviteInput,signingSecret,updateInvite,type Invite} from '@/lib/invites';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});

// Admin only: list invites with their links, create one, turn one off or back on, replace a link, and switch
// (site access is the Vercel password). Links are derived from the signing secret, so they are never stored.
async function denied(request:Request,write:boolean){
  if(write&&!sameOrigin(request))return json({error:'Invalid request origin.'},403);
  if(!await isAdmin(request.headers))return json({error:'Sign in to the invite dashboard first.'},401);
  return null;
}
async function withLinks(invites:Invite[]){const secret=await signingSecret();return invites.map(invite=>({...invite,link:invitePath(secret,invite)}));}
async function body(request:Request){const text=await request.text();if(text.length>20000)throw new Error('Request too large.');return JSON.parse(text) as Record<string,unknown>;}

export async function GET(request:Request){
  const no=await denied(request,false);if(no)return no;
  try{return json({invites:await withLinks(await listInvites())});}
  catch(error){console.error('Invite list failed',error);return json({error:'Invites could not load. Please try again.'},503);}
}
export async function POST(request:Request){
  const no=await denied(request,true);if(no)return no;
  let value;try{value=await body(request);}catch{return json({error:'Invalid request.'},400);}
  // Several people at once: each gets their own link with the same access. People who already have an active
  // invite for the same email are left as they are, so pasting a list twice does not create duplicates.
  if(typeof value.people==='string'){
    const {people,errors}=parsePeople(value.people);
    if(errors.length)return json({error:errors.join(' ')},400);
    if(!people.length)return json({error:'Add at least one person, one per line.'},400);
    if(people.length>50)return json({error:'Add up to 50 people at a time.'},400);
    const checked=people.map(person=>parseInviteInput({...value,...person,note:typeof value.note==='string'?value.note:''}));
    const problem=checked.find(item=>typeof item==='string');if(problem)return json({error:problem},400);
    try{
      const existing=new Set((await listInvites()).filter(invite=>!invite.revokedAt&&invite.email).map(invite=>invite.email.toLowerCase()));
      const created=[],skipped:string[]=[];
      for(const input of checked as Exclude<(typeof checked)[number],string>[]){
        if(input.email&&existing.has(input.email.toLowerCase())){skipped.push(input.name);continue;}
        created.push(await createInvite(input,'Workspace admin'));if(input.email)existing.add(input.email.toLowerCase());
      }
      return json({invites:await withLinks(created),skipped},201);
    }catch(error){console.error('Bulk invite failed',error);return json({error:'Some invites may not have been created. Refresh to see which.'},503);}
  }
  const input=parseInviteInput(value);
  if(typeof input==='string')return json({error:input},400);
  try{const [invite]=await withLinks([await createInvite(input,'Workspace admin')]);return json({invite},201);}
  catch(error){console.error('Invite create failed',error);return json({error:'The invite was not created. Please try again.'},503);}
}
export async function PATCH(request:Request){
  const no=await denied(request,true);if(no)return no;
  let value;try{value=await body(request);}catch{return json({error:'Invalid request.'},400);}
  try{
    const action=value.action;
    if(typeof value.id!=='string'||(action!=='revoke'&&action!=='restore'&&action!=='new-link'))return json({error:'Invalid invite change.'},400);
    if(!await getInvite(value.id))return json({error:'That invite no longer exists.'},404);
    const invite=await updateInvite(value.id,action);
    if(!invite)return json({error:'That invite already changed. Refresh and try again.'},409);
    const [withLink]=await withLinks([invite]);return json({invite:withLink});
  }catch(error){console.error('Invite update failed',error);return json({error:'The change was not saved. Please try again.'},503);}
}
