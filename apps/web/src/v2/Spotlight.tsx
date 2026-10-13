import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
type Box={left:number;top:number;right:number;bottom:number};
/** Four independent blur panes keep the real target interactive; no cloned state or fake clicks. */
export default function Spotlight({target,focusTarget,title,children,index,total,ready,onNext,onBack,onSkip,language,label}:{target:string;focusTarget?:string;title:string;children:ReactNode;index:number;total:number;ready:boolean;onNext():void;onBack():void;onSkip():void;language:string;label?:string}){
 const [box,setBox]=useState<Box|null>(null),[cardTop,setCardTop]=useState<number|undefined>();
 const card=useRef<HTMLElement>(null),next=useRef<HTMLButtonElement>(null),skip=useRef(onSkip);skip.current=onSkip;
 const origin=useRef<HTMLElement|null>(document.activeElement as HTMLElement|null);
 const ru=language!=='en';
 useLayoutEffect(()=>{
  let frame=0,needsFocus=true;const el=document.querySelector<HTMLElement>(target);
  if(el?.closest('.v2-modal,.dp-sheet'))el.scrollIntoView({block:'start',behavior:'instant'});
  const host=document.querySelector<HTMLElement>('.v2-game');
  const measure=()=>{
   if(needsFocus){
    const activeTarget=document.querySelector<HTMLElement>(focusTarget??target),selectors='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]';
    const actionable=activeTarget?.matches(selectors)?activeTarget:activeTarget?.querySelector<HTMLElement>(selectors);
    const focus=next.current&&!next.current.disabled?next.current:actionable;
    if(focus?.getClientRects().length){focus.focus();needsFocus=false;}
   }
   const ch=card.current?.getBoundingClientRect().height??230;
   host?.style.setProperty('--v2-guide-height',`${Math.ceil(ch)}px`);
   const targetEl=document.querySelector<HTMLElement>(target),r=targetEl?.getBoundingClientRect(),h=innerHeight,w=innerWidth;
   if(!r||r.width===0||r.height===0){setBox(null);setCardTop(undefined);return;}
   const container=targetEl?.closest('.v2-modal,.dp-sheet')?.getBoundingClientRect();
   const b={left:Math.max(6,r.left-6),right:Math.min(w-6,r.right+6),top:Math.min(h-6,Math.max(6,r.top-6,container?.top??0)),bottom:Math.max(6,Math.min(h-6,r.bottom+6,container?.bottom??h))};
   setBox(b);
   setCardTop(b.bottom+12+ch<h-12?b.bottom+12:b.top-ch-12>12?b.top-ch-12:undefined);
  };
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
  const ro=new ResizeObserver(update);if(el)ro.observe(el);if(el?.closest('.v2-modal'))ro.observe(el.closest('.v2-modal')!);if(card.current)ro.observe(card.current);
  const mo=new MutationObserver(update);mo.observe(document.querySelector('.v2-game')??document.body,{childList:true,subtree:true});
  window.addEventListener('resize',update);document.addEventListener('scroll',update,true);measure();
  return()=>{cancelAnimationFrame(frame);ro.disconnect();mo.disconnect();window.removeEventListener('resize',update);document.removeEventListener('scroll',update,true);host?.style.removeProperty('--v2-guide-height');};
 },[target,focusTarget,index,ready]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();skip.current();}
   if(e.key==='Tab'){
    const selectors='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]';
    const targetEl=document.querySelector<HTMLElement>(target);
    const all=[...(targetEl?.matches(selectors)?[targetEl]:[]),...(targetEl?.querySelectorAll<HTMLElement>(selectors)??[]),...(card.current?.querySelectorAll<HTMLElement>(selectors)??[])].filter(el=>el.getClientRects().length>0);
    if(!all.length)return;const i=all.indexOf(document.activeElement as HTMLElement),n=e.shiftKey?(i<=0?all.length-1:i-1):(i+1)%all.length;
    e.preventDefault();e.stopImmediatePropagation();all[n]?.focus();
   }
  };
  document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('keydown',key,true);};
 },[target]);
 useEffect(()=>()=>{const previous=origin.current;if(previous?.isConnected&&previous!==document.body&&!previous.closest('.v2-guide'))previous.focus();else document.querySelector<HTMLElement>('[data-guide="partner"]')?.focus();},[]);
 const h=innerHeight,w=innerWidth;
 const panes=box?[{left:0,top:0,width:w,height:box.top},{left:0,top:box.bottom,width:w,height:h-box.bottom},{left:0,top:box.top,width:box.left,height:box.bottom-box.top},{left:box.right,top:box.top,width:w-box.right,height:box.bottom-box.top}]:[{left:0,top:0,width:w,height:h}];
 return <div className="v2-guide" data-step={index}>
  {panes.map((style,i)=><div className="v2-guide-shade" key={i} style={style} aria-hidden="true"/>)}
  {box&&<div className="v2-guide-ring" style={{left:box.left,top:box.top,width:box.right-box.left,height:box.bottom-box.top}} aria-hidden="true"/>}
  <section className="v2-guide-card" ref={card} style={cardTop===undefined?{}:{top:cardTop,bottom:'auto'}} role="dialog" aria-modal="true" aria-labelledby="v2-guide-title" aria-describedby="v2-guide-body">
   <span className="v2-eyebrow">{label??`${ru?'Первый договор':'Your first pact'} · OFFCHAIN`} · {index+1}/{total}</span>
   <h2 id="v2-guide-title">{title}</h2><div id="v2-guide-body">{children}</div>
   {!box&&<p className="v2-fine">{ru?'Элемент пока не показан. Можно закрыть обучение и вернуться из меню.':'The target is not visible yet. You can leave and replay from the menu.'}</p>}
   <div className="v2-button-row"><button disabled={index===0} onClick={onBack}>{ru?'Назад':'Back'}</button><button ref={next} className="v2-primary" disabled={!ready} onClick={onNext}>{index===total-1?(ru?'Понятно':'Got it'):(ru?'Продолжить':'Continue')}</button><button onClick={onSkip}>{ru?'Пропустить':'Skip'}</button></div>
  </section>
 </div>;
}
