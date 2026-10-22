'use client';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import styles from './about-dialog.module.css';

/** Native modal behavior owns keyboard focus, background inertness and return
 * focus. Keep the element mounted so closing it restores the actual opener. */
export default function AboutDialog({open,onOpenChange,children}:{open:boolean;onOpenChange:(open:boolean)=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current;if(!dialog)return;
  if(open&&!dialog.open)dialog.showModal();
  else if(!open&&dialog.open)dialog.close();
 },[open]);
 return <dialog ref={ref} className={'modal '+styles.dialog} aria-modal="true" aria-labelledby="about-title" onCancel={()=>onOpenChange(false)} onClose={()=>onOpenChange(false)} onClick={event=>{
  // Backdrop clicks are retargeted to the dialog. Close only when the pointer
  // is outside its bounds, preserving clicks and text selection inside it.
  if(event.target!==event.currentTarget)return;
  const bounds=event.currentTarget.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)onOpenChange(false);
 }}>{children}</dialog>;
}
