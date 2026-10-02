import {vercelIdentity} from '@/lib/vercel-session';
import {inviteIdentity,isAdmin,sessionInvite,sharedOwnerKey,type Invite} from '@/lib/invites';
import type {WorkspaceIdentity} from './workspace-identity';

export type Access={identity:WorkspaceIdentity;invite:Invite|null}|{identity:null};
/**
 * Who is using the workspace. A personal invite link wins: its person uses the workspace the invite names. The admin
 * uses the shared workspace. Everyone else gets the workspace's existing access (the shared workspace, or the workspace
 * password when one is required). The app never turns away someone who got past the site's Vercel password.
 */
export async function workspaceAccess(headers:Pick<Headers,'get'>):Promise<Access>{
  const invite=await sessionInvite(headers);
  if(invite)return {identity:inviteIdentity(invite,invite.workspace==='shared'?await vercelIdentity(headers):null),invite};
  if(await isAdmin(headers)){const shared=await vercelIdentity(headers),key=sharedOwnerKey();return {identity:{primaryKey:shared?.primaryKey??key,lookupKeys:shared?.lookupKeys??[key],actor:'Workspace admin',accessMode:'shared'},invite:null};}
  const identity=await vercelIdentity(headers);
  return identity?{identity,invite:null}:{identity:null};
}
