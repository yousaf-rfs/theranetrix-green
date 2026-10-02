import {z} from 'zod';
import {ADVISOR_NAME} from './product-names';
export const dashboardColumns=['medications','outcomes','plan'] as const;
export const dashboardFilters=['All patients','Needs review','Benefit reported','Side effects reported','Response missing'] as const;
export const dashboardColumnLabels={medications:'Medication & reported response',outcomes:'Overall outcomes',plan:'Suggested next steps & plan'};
export const reviewSections=['medications','outcomes','twin','pst','shadow','advisor','pathway','evidence','notes'] as const;
export const reviewSectionLabels={medications:'Medication response',outcomes:'Outcome changes',twin:'Digital Twin',pst:'PST strategy comparison',shadow:'Shadow AI review',advisor:ADVISOR_NAME+' and patient voice',pathway:'Care activities',evidence:'Sources and evidence gaps',notes:'Documentation'};
export const dashboardLayoutSchema=z.object({
  columns:z.array(z.enum(dashboardColumns)).min(1,'Keep at least one clinical column.').max(3).refine(v=>new Set(v).size===v.length,'Columns must be unique.'),
  showEngines:z.boolean(),showSummary:z.boolean(),showDemoLinks:z.boolean(),showEngineIntro:z.boolean(),
  density:z.enum(['comfortable','compact']),filter:z.enum(dashboardFilters),sort:z.enum(['priority','name','visit']),clinician:z.string().max(100),
  reviewSections:z.array(z.enum(reviewSections)).min(1).max(reviewSections.length).refine(v=>new Set(v).size===v.length,'Sections must be unique.').optional(),
}).strict();
export type DashboardLayout=z.infer<typeof dashboardLayoutSchema>;
export type DashboardProfile={id:string;name:string;layout:DashboardLayout;revision:string;updatedAt:string;updatedBy:string};
export function defaultDashboardLayout():DashboardLayout{return {columns:[...dashboardColumns],showEngines:false,showSummary:true,showDemoLinks:false,showEngineIntro:false,density:'compact',filter:'All patients',sort:'priority',clinician:'All clinicians'};}

/** Reorders presentation only; unknown items and cross-list drops are ignored. */
export function reorderDashboardItems<T extends string>(items:readonly T[],from:string,to:string):T[]{
  const next=[...items],source=next.findIndex(item=>item===from),target=next.findIndex(item=>item===to);
  if(source<0||target<0||source===target)return next;
  const [moved]=next.splice(source,1);next.splice(target,0,moved);return next;
}
