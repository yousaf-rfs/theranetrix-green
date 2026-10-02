import {createHmac,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {postgresWorkspace} from '@/lib/postgres-workspace';
import type {WorkspaceIdentity} from './workspace-identity';

// Personal invite links. The workspace admin creates an invite for each person; the link carries the invite id and a
// signature, so nothing secret is stored beside the invite. Opening the link signs that person in on that browser.
// "New link" bumps the invite's link version, which retires the old link and every session opened from it. Revoking
// ends access on the next request. Site access itself is the Vercel password; links never lock anyone else out.

export type InviteRole='clinician'|'patient';
export type InviteWorkspace='own'|'shared';
export type Invite={id:string;name:string;email:string;role:InviteRole;workspace:InviteWorkspace;note:string;createdAt:string;createdBy:string;revokedAt:string|null;linkVersion:number;openCount:number;lastOpenedAt:string|null;lastSeenAt:string|null};
type Row={id:string;name:string;email:string;role:string;workspace:string;note:string;created_at:string;created_by:string;revoked_at:string|null;link_version:number|string;open_count:number|string;last_opened_at:string|null;last_seen_at:string|null};

export const inviteCookie='__Host-theranetrix-invite';
export const adminCookie='__Host-theranetrix-admin';
export const inviteSeconds=60*60*24*30;
export const adminSeconds=60*60*12;
const db=()=>postgresWorkspace;
const columns='id,name,email,role,workspace,note,created_at,created_by,revoked_at,link_version,open_count,last_opened_at,last_seen_at';
const fromRow=(row:Row):Invite=>({id:row.id,name:row.name,email:row.email,role:row.role==='patient'?'patient':'clinician',workspace:row.workspace==='shared'?'shared':'own',note:row.note,createdAt:row.created_at,createdBy:row.created_by,revokedAt:row.revoked_at,linkVersion:Number(row.link_version),openCount:Number(row.open_count),lastOpenedAt:row.last_opened_at,lastSeenAt:row.last_seen_at});

// ---- settings and the signing secret -------------------------------------------------------------------------------
async function setting(key:string){return (await db().prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{value:string}>())?.value??null;}
let cachedSecret:string|null=null;
/** AUTH_SECRET when the deployment sets one; otherwise a random secret created once and kept in the database. */
export async function signingSecret(){
  const env=process.env.AUTH_SECRET;if(env&&env.length>=32)return env;
  if(cachedSecret)return cachedSecret;
  await db().prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT (key) DO NOTHING').bind('session_secret',randomBytes(48).toString('base64url')).run();
  const value=await setting('session_secret');if(!value||value.length<32)throw new Error('Invite signing is unavailable.');
  return cachedSecret=value;
}

// ---- signed values ---------------------------------------------------------------------------------------------------
const mac=(secret:string,value:string)=>createHmac('sha256',secret).update(value).digest('base64url');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function signValue(secret:string,payload:Record<string,unknown>){const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+mac(secret,body);}
export function readSigned(secret:string,token:string|undefined,now=Date.now()):Record<string,unknown>|null{
  if(!token||token.length>2048)return null;
  const [body,signature,extra]=token.split('.');if(!body||!signature||extra!==undefined||!equal(signature,mac(secret,body)))return null;
  try{const value=JSON.parse(Buffer.from(body,'base64url').toString()) as Record<string,unknown>;return typeof value.exp==='number'&&value.exp>Math.floor(now/1000)?value:null;}catch{return null;}
}
/** The token in an invite link: the invite id and a signature over the id and its link version. */
export const linkToken=(secret:string,invite:Pick<Invite,'id'|'linkVersion'>)=>invite.id+'.'+mac(secret,`invite-link:${invite.id}:${invite.linkVersion}`).slice(0,32);
export const invitePath=(secret:string,invite:Pick<Invite,'id'|'linkVersion'>)=>'/i/'+linkToken(secret,invite);
export function cookieValue(headers:Pick<Headers,'get'>,name:string){return headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1);}
export function sameOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin;}
export const cookieHeader=(name:string,value:string,seconds:number)=>`${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${value?seconds:0}`;

// ---- invites ---------------------------------------------------------------------------------------------------------
export async function listInvites():Promise<Invite[]>{return (await db().prepare(`SELECT ${columns} FROM invites ORDER BY created_at DESC`).bind().all<Row>()).map(fromRow);}
export async function getInvite(id:string):Promise<Invite|null>{const row=await db().prepare(`SELECT ${columns} FROM invites WHERE id = ?`).bind(id).first<Row>();return row?fromRow(row):null;}
export type InviteInput={name:string;email:string;role:InviteRole;workspace:InviteWorkspace;note:string};
export function parseInviteInput(value:unknown):InviteInput|string{
  if(!value||typeof value!=='object')return 'Invite details are required.';
  const v=value as Record<string,unknown>,text=(key:string,max:number)=>typeof v[key]==='string'?(v[key] as string).trim().slice(0,max):'';
  const name=text('name',80),email=text('email',160),note=text('note',300);
  if(!name)return 'Enter the person’s name.';
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return 'That email address does not look right.';
  if(v.role!=='clinician'&&v.role!=='patient')return 'Choose where the link opens.';
  if(v.workspace!=='own'&&v.workspace!=='shared')return 'Choose which workspace they use.';
  return {name,email,note,role:v.role,workspace:v.workspace};
}
/** Several people at once, as "Name, email", "Name <email>" or a bare email per line, all with the same access. */
export function parsePeople(text:string):{people:{name:string;email:string}[];errors:string[]}{
  const people:{name:string;email:string}[]=[],errors:string[]=[];
  for(const [index,raw] of text.split(/\r?\n/).entries()){
    const line=raw.trim();if(!line)continue;
    const email=line.match(/[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/)?.[0]??'';
    let name=line.replace(email,'').replace(/[<>,;]/g,' ').replace(/\s+/g,' ').trim();
    if(!name&&email)name=email.split('@')[0].split(/[._-]+/).filter(part=>/[a-z]/i.test(part)).map(part=>part[0].toUpperCase()+part.slice(1).toLowerCase()).join(' ');
    if(!name){errors.push(`Line ${index+1}: add a name or an email address.`);continue;}
    people.push({name:name.slice(0,80),email:email.slice(0,160)});
  }
  return {people,errors};
}
export async function createInvite(input:InviteInput,createdBy:string,now=new Date().toISOString()){
  const id=randomBytes(9).toString('base64url');
  await db().prepare('INSERT INTO invites (id,name,email,role,workspace,note,created_at,created_by,link_version,open_count) VALUES (?,?,?,?,?,?,?,?,1,0)').bind(id,input.name,input.email,input.role,input.workspace,input.note,now,createdBy).run();
  return (await getInvite(id))!;
}
export async function updateInvite(id:string,action:'revoke'|'restore'|'new-link',now=new Date().toISOString()){
  const statement=action==='revoke'?'UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL':action==='restore'?'UPDATE invites SET revoked_at = NULL WHERE id = ? AND revoked_at IS NOT NULL':'UPDATE invites SET link_version = link_version + 1, open_count = 0, last_opened_at = NULL WHERE id = ?';
  const result=await db().prepare(statement).bind(...(action==='revoke'?[now,id]:[id])).run();
  return result.meta.changes===1?getInvite(id):null;
}
/** The active invite a link token names, or null for an unknown, retired or revoked link. */
export async function inviteForLink(token:string):Promise<Invite|null>{
  if(!/^[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{32}$/.test(token))return null;
  const invite=await getInvite(token.slice(0,12));if(!invite||invite.revokedAt)return null;
  return equal(token,linkToken(await signingSecret(),invite))?invite:null;
}
/** Record that the link was opened and return the session cookie for this browser. */
export async function openInvite(invite:Invite,now=new Date()){
  await db().prepare('UPDATE invites SET open_count = open_count + 1, last_opened_at = ?, last_seen_at = ? WHERE id = ?').bind(now.toISOString(),now.toISOString(),invite.id).run();
  return cookieHeader(inviteCookie,signValue(await signingSecret(),{sub:'invite',id:invite.id,v:invite.linkVersion,exp:Math.floor(now.getTime()/1000)+inviteSeconds}),inviteSeconds);
}
/** The invite behind this browser's invite session, while it is active and its link has not been replaced. */
export async function sessionInvite(headers:Pick<Headers,'get'>,now=Date.now()):Promise<Invite|null>{
  const token=cookieValue(headers,inviteCookie);if(!token)return null;
  const session=readSigned(await signingSecret(),token,now);if(session?.sub!=='invite'||typeof session.id!=='string')return null;
  const invite=await getInvite(session.id);if(!invite||invite.revokedAt||invite.linkVersion!==session.v)return null;
  // Last active is kept to within five minutes, so browsing does not write on every request.
  const stamp=new Date(now).toISOString(),stale=new Date(now-5*60_000).toISOString();
  if(!invite.lastSeenAt||invite.lastSeenAt<stale)await db().prepare('UPDATE invites SET last_seen_at = ? WHERE id = ?').bind(stamp,invite.id).run().catch(error=>console.error('Invite activity not recorded',error));
  return invite;
}
export const sharedOwnerKey=()=>process.env.WORKSPACE_OWNER_KEY??'workspace-owner';
/** The workspace an invite uses: its own copy of the demo, or the shared workspace. */
export function inviteIdentity(invite:Invite,shared?:WorkspaceIdentity|null):WorkspaceIdentity{
  if(invite.workspace==='own'){const key='invite:'+invite.id;return {primaryKey:key,lookupKeys:[key],actor:invite.name,accessMode:'shared'};}
  const key=shared?.primaryKey??sharedOwnerKey();
  return {primaryKey:key,lookupKeys:shared?.lookupKeys??[key],actor:invite.name,accessMode:'shared'};
}

// ---- admin -----------------------------------------------------------------------------------------------------------
export async function adminConfigured(){return !!await setting('admin_password_hash');}
const hashPassword=(password:string,salt=randomBytes(16).toString('hex'))=>salt+':'+scryptSync(password,salt,64).toString('hex');
/** First visit only: sets the admin password. Returns false when one is already set. */
export async function setupAdmin(password:string){
  const result=await db().prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT (key) DO NOTHING').bind('admin_password_hash',hashPassword(password)).run();
  return result.meta.changes===1;
}
export async function verifyAdmin(password:string){
  const [salt,hash]=(await setting('admin_password_hash'))?.split(':')??[];if(!salt||!hash)return false;
  return equal(hashPassword(password,salt).split(':')[1],hash);
}
export async function adminSessionHeader(now=Date.now()){return cookieHeader(adminCookie,signValue(await signingSecret(),{sub:'admin',exp:Math.floor(now/1000)+adminSeconds}),adminSeconds);}
export async function isAdmin(headers:Pick<Headers,'get'>,now=Date.now()){const token=cookieValue(headers,adminCookie);return !!token&&readSigned(await signingSecret(),token,now)?.sub==='admin';}
