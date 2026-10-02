import TheraNetrix from '@/components/theranetrix/app';
export default async function Page({params}:{params:Promise<{slug:string[]}>}){const {slug}=await params;return <TheraNetrix path={'/'+slug.join('/')}/>;}
