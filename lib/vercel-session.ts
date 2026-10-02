import {createHmac,timingSafeEqual,scryptSync,randomBytes} from 'node:crypto';
import type {WorkspaceIdentity} from './workspace-identity';

export const sessionCookie='__Host-theranetrix-session';
export const sessionSeconds=60*60*12;
function secret(){const value=process.env.AUTH_SECRET;if(!value||value.length<32)throw new Error('Authentication is not configured');return value;}
export function passwordRequired(){return process.env.WORKSPACE_REQUIRE_PASSWORD==='true';}
export function configured(){return !!process.env.DATABASE_URL&&(!passwordRequired()||(!!process.env.WORKSPACE_PASSWORD_HASH&&!!process.env.AUTH_SECRET&&process.env.AUTH_SECRET.length>=32));}
export function verifyPassword(password:string){
  const [salt,hash]=process.env.WORKSPACE_PASSWORD_HASH?.split(':')??[];
  if(!salt||!hash||!/^[a-f0-9]{128}$/.test(hash))throw new Error('Authentication is not configured');
  const actual=scryptSync(password,salt,64),expected=Buffer.from(hash,'hex');
  return timingSafeEqual(actual,expected);
}
export function issueSession(now=Date.now()){
  const payload=Buffer.from(JSON.stringify({sub:'workspace-owner',exp:Math.floor(now/1000)+sessionSeconds,nonce:randomBytes(16).toString('hex')})).toString('base64url');
  return payload+'.'+createHmac('sha256',secret()).update(payload).digest('base64url');
}
export async function vercelIdentity(headers:Pick<Headers,'get'>,now=Date.now()):Promise<WorkspaceIdentity|null>{
  const key=process.env.WORKSPACE_OWNER_KEY??'workspace-owner';
  // Keep the existing workspace and records. Shared visitors are not verified
  // owners, even when an old cookie or owner display name remains configured.
  if(!passwordRequired())return {primaryKey:key,lookupKeys:[key],actor:'Shared workspace visitor',accessMode:'shared'};
  const token=headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1);
  if(!token||token.length>2048)return null;
  const parts=token.split('.');if(parts.length!==2)return null;
  const [payload,signature]=parts;const expected=createHmac('sha256',secret()).update(payload).digest('base64url');
  if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;
  try{const session=JSON.parse(Buffer.from(payload,'base64url').toString());
    if(session.sub!=='workspace-owner'||!Number.isInteger(session.exp)||session.exp<=Math.floor(now/1000)||session.exp>Math.floor(now/1000)+sessionSeconds)return null;
    return {primaryKey:key,lookupKeys:[key],actor:process.env.WORKSPACE_OWNER_NAME??'Workspace owner',accessMode:'password'};
  }catch{return null;}
}
export function sessionHeader(token:string){return `${sessionCookie}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${token?sessionSeconds:0}`;}
export function sameOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin;}
