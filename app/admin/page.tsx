import type {Metadata} from 'next';
import {InviteDashboard} from '@/components/admin/invite-dashboard';
export const metadata:Metadata={title:'Invites | TheraNetrix',robots:{index:false,follow:false}};
export default function AdminPage(){return <InviteDashboard/>;}
