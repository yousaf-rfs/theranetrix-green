'use client';

import {CalendarDays, X} from 'lucide-react';
import {Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle} from '@/components/ui/sheet';
import {useState} from 'react';
import type {Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {PatientReviewDetails} from './patient-review-details';
import {MedicationDialog,PlanDialog} from './medications';
import {visitObservations} from '@/lib/visit-presentation';
import {Avatar, formatDate} from './ui';
import {dobText} from './patient-identity';
import styles from './patient-preview-panel.module.css';

/** Full quick-review content for the standalone home preview. */
export function PatientPreviewPanel({patient, ctx, open, onOpenChange, returnFocus, onPatientDetails}: {
  patient: Patient | null;
  ctx: Context;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
  onPatientDetails: (patientId: string) => void;
}) {
  const [medicationPatient,setMedicationPatient]=useState<string|null>(null);
  const [planPatient,setPlanPatient]=useState<string|null>(null);
  const report = patient ? visitObservations(patient).at(-1) : undefined;
  return <Sheet open={open} onOpenChange={onOpenChange}>
    {patient && <SheetContent className={styles.panel} showCloseButton={false}
      onCloseAutoFocus={event => {event.preventDefault(); returnFocus();}}>
      <header className={styles.header}>
        <div className={styles.headingRow}><span className={styles.eyebrow}>Patient overview</span>
          <SheetClose className={styles.close}><X size={18} aria-hidden="true"/>Close</SheetClose>
        </div>
        <div className={styles.identity}><Avatar patient={patient}/><div>
          <SheetTitle className={styles.title}>{patient.name}</SheetTitle>
          <SheetDescription className={styles.description}>{patient.condition}</SheetDescription>
        </div></div>
        <div className={styles.metadata}><span>{dobText(patient.dateOfBirth)} · {patient.age} years</span>
          <span>MRN {patient.medicalRecordNumber || patient.id}</span></div>
      </header>
      <div className={styles.body}>
        <section className={styles.section} aria-label="Latest report">
          <div className={styles.sectionHeading}><h3>Latest report</h3>{report && <span className={styles.reportDate}><CalendarDays size={14} aria-hidden="true"/>{formatDate(report.date)}</span>}</div>
          {report ? <div className={styles.scores}>{(['pain', 'function', 'sleep'] as const).map(metric => <div className={styles.score} key={metric}>
            <span>{metric === 'pain' ? 'Pain' : metric === 'function' ? 'Function' : 'Sleep'}</span>
            <strong>{report[metric] ?? 'N/A'}{report[metric] != null && <small>/10</small>}</strong>
            <div className={styles.track} aria-hidden="true"><span data-metric={metric} style={{width: `${Math.max(0, Math.min(10, report[metric] ?? 0)) * 10}%`}}/></div>
            <small>{report[metric] == null ? 'Not recorded' : metric === 'pain' ? 'Lower is better' : 'Higher is better'}</small>
          </div>)}</div> : <p>No patient report recorded yet.</p>}
        </section>
        <PatientReviewDetails p={patient} ctx={ctx}
          onReviewMedications={()=>setMedicationPatient(patient.id)}
          onReviewPlan={()=>setPlanPatient(patient.id)}/>
      </div>
      <footer className={styles.footer}><span>Sample patient · Changes reset on refresh</span><button type="button" className={styles.done} onClick={()=>onPatientDetails(patient.id)}>Patient details</button></footer>
      <MedicationDialog patientId={medicationPatient} close={()=>setMedicationPatient(null)} ctx={ctx}/>
      <PlanDialog patientId={planPatient} close={()=>setPlanPatient(null)} ctx={ctx}/>
    </SheetContent>}
  </Sheet>;
}
