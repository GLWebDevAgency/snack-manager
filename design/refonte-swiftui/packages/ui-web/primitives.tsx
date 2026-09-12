'use client';
import {useEffect, useId, useRef, type ReactNode, type CSSProperties, type ButtonHTMLAttributes, type InputHTMLAttributes} from 'react';
import {theme, type Mode} from '@sm/design-tokens';
import {renderIcon, type IconName} from '@sm/design-icons';
import {renderArtwork} from '@sm/design-assets';
import {actionPresentation, boundedIndex, type PresentationPhase} from '@sm/design-presentation';

export function ThemeBoundary({mode='light',accent,children,className=''}:{mode?:Mode;accent?:string;children:ReactNode;className?:string}) {
 const values=Object.fromEntries(Object.entries(theme(mode,accent)).map(([k,v])=>['--sm-'+k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()),v]));
 return <div className={`sm-ui ${className}`} data-theme={mode} style={values as CSSProperties}>{children}</div>;
}
export function Icon({name,label,size=20}:{name:IconName;label?:string;size?:number}) {
 return <span className="sm-icon" role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true} style={{width:size,height:size}} dangerouslySetInnerHTML={{__html:renderIcon(name)}}/>;
}
export function Artwork({name,label}:{name:string;label?:string}) {
 const id='art-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
 return <span className="sm-art" role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true} dangerouslySetInnerHTML={{__html:renderArtwork(name,id)}}/>;
}
export type ButtonProps=ButtonHTMLAttributes<HTMLButtonElement>&{tone?:'primary'|'secondary'|'danger'|'quiet';phase?:PresentationPhase;icon?:IconName};
export function Button({tone='secondary',phase='idle',icon,children,disabled,className='',type='button',...props}:ButtonProps) {
 const p=actionPresentation(phase);
 return <button {...props} type={type} className={`sm-button sm-button--${tone} ${className}`} disabled={disabled||p.disabled} aria-busy={p.busy||undefined}>{icon?<Icon name={icon}/>:null}{children}</button>;
}
export function IconButton({label,icon,...props}:Omit<ButtonProps,'children'|'icon'>&{label:string;icon:IconName}) {
 return <Button {...props} aria-label={label} title={label} icon={icon} className={`sm-icon-button ${props.className??''}`}/>;
}
export function StatusBadge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'success'|'warning'|'danger'|'info'}) {
 return <span className={`sm-badge sm-tone-${tone}`}>{children}</span>;
}
export function Notice({children,tone='info',title}:{children:ReactNode;tone?:'info'|'warning'|'danger'|'success';title?:string}) {
 return <div className={`sm-notice sm-tone-${tone}`} role={tone==='danger'?'alert':'status'}><Icon name={tone==='danger'||tone==='warning'?'warning':'info'}/><div>{title?<strong>{title}</strong>:null}<div>{children}</div></div></div>;
}
export function TextField({label,error,hint,id,...props}:InputHTMLAttributes<HTMLInputElement>&{label:string;error?:string;hint?:string}) {
 const generated=useId(),key=id??generated;const described=[hint?key+'-hint':null,error?key+'-error':null,props['aria-describedby']].filter(Boolean).join(' ')||undefined;
 return <div className="sm-field"><label htmlFor={key}>{label}</label><input {...props} id={key} aria-invalid={error?true:props['aria-invalid']} aria-describedby={described}/>{hint?<small id={key+'-hint'}>{hint}</small>:null}{error?<span id={key+'-error'} className="sm-error">{error}</span>:null}</div>;
}
export interface Segment {value:string;label:string;disabled?:boolean}
export function SegmentedControl({label,options,value,onChange}:{label:string;options:readonly Segment[];value:string;onChange:(value:string)=>void}) {
 const refs=useRef<(HTMLButtonElement|null)[]>([]);
 const focusValue=options.find(o=>o.value===value&&!o.disabled)?.value??options.find(o=>!o.disabled)?.value;
 return <div className="sm-segmented" role="radiogroup" aria-label={label}>{options.map((option,index)=><button key={option.value} ref={el=>{refs.current[index]=el;}} type="button" role="radio" aria-checked={value===option.value} disabled={option.disabled} tabIndex={focusValue===option.value?0:-1} onClick={()=>onChange(option.value)} onKeyDown={event=>{
  if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();const enabled=options.map((v,i)=>v.disabled?-1:i).filter(i=>i>=0);if(!enabled.length)return;
  const i=enabled.indexOf(index),delta=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
  const next=event.key==='Home'?enabled[0]:event.key==='End'?enabled[enabled.length-1]:enabled[boundedIndex(Math.max(0,i),enabled.length,delta)];
  const item=options[next];if(item){onChange(item.value);refs.current[next]?.focus();}
 }}>{option.label}</button>)}</div>;
}
export function Stepper({label,value,onDecrement,onIncrement,canDecrement=true,canIncrement=true,disabled=false}:{label:string;value:string;onDecrement:()=>void;onIncrement:()=>void;canDecrement?:boolean;canIncrement?:boolean;disabled?:boolean}) {
 return <div className="sm-stepper" role="group" aria-label={label}><IconButton label={`Diminuer ${label}`} icon="minus" onClick={onDecrement} disabled={disabled||!canDecrement}/><output>{value}</output><IconButton label={`Augmenter ${label}`} icon="plus" onClick={onIncrement} disabled={disabled||!canIncrement}/></div>;
}
export function Surface({children,title,actions}:{children:ReactNode;title?:string;actions?:ReactNode}) {
 return <section className="sm-surface">{title||actions?<header className="sm-surface-head">{title?<h2>{title}</h2>:null}{actions}</header>:null}{children}</section>;
}
export function SheetFrame({title,children,footer,onClose,blockDismiss=false}:{title:string;children:ReactNode;footer?:ReactNode;onClose:()=>void;blockDismiss?:boolean}) {
 return <section className="sm-sheet"><header className="sm-sheet-head"><h2>{title}</h2><IconButton label="Fermer" icon="close" onClick={onClose} disabled={blockDismiss}/></header><div className="sm-sheet-body">{children}</div>{footer?<footer className="sm-sheet-foot">{footer}</footer>:null}</section>;
}
/** Optional HTML dialog host. Keep the application's existing proven host during migration. */
export function Dialog({open,title,children,footer,onClose,blockDismiss=false}:{open:boolean;title:string;children:ReactNode;footer?:ReactNode;onClose:()=>void;blockDismiss?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null),titleId=useId();
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;if(open&&!dialog.open)dialog.showModal();else if(!open&&dialog.open)dialog.close();return()=>{if(dialog.open)dialog.close();};},[open]);
 return <dialog ref={ref} className="sm-dialog" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!blockDismiss)onClose();}}><div className="sm-sheet"><header className="sm-sheet-head"><h2 id={titleId}>{title}</h2><IconButton label="Fermer" icon="close" onClick={onClose} disabled={blockDismiss}/></header><div className="sm-sheet-body">{children}</div>{footer?<footer className="sm-sheet-foot">{footer}</footer>:null}</div></dialog>;
}
export function EmptyState({title,description,action,icon='box'}:{title:string;description:string;action?:ReactNode;icon?:IconName}) {
 return <div className="sm-empty"><Icon name={icon} size={32}/><h2>{title}</h2><p>{description}</p>{action}</div>;
}
export function Skeleton({label='Chargement'}:{label?:string}) {
 return <div className="sm-skeleton" role="status" aria-label={label}><span aria-hidden="true"/><span aria-hidden="true"/><span aria-hidden="true"/></div>;
}
