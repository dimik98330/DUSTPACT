import { Droplets, Wrench, Package } from "lucide-react";
import type { Bundle, Seat } from "./model";
export const resourceNames = [["вода", "water"], ["инструменты", "tools"], ["груз", "cargo"]];
const ICONS = [Droplets, Wrench, Package];
export function BundleDisplay({ value, language, label, compact=false }: {value: Bundle; language: string; label?: string;compact?:boolean}) {
  return <span className="v2-bundle" aria-label={label ?? value.map((n,i)=>`${n} ${resourceNames[i][language==="en"?1:0]}`).join(", ")}>{value.map((n,i) => { const Icon=ICONS[i]; return !compact||n>0?<span key={i} title={resourceNames[i][language==="en"?1:0]}><Icon size={19}/><b>{n}</b></span>:null; })}</span>;
}
export default function Resources({seat,language}: {seat: Seat; language: string}) {
  const purpose=language==='en'?['Drinking and production inputs','Consumable work kits: one is spent on repair','Earned cargo: delivery and personal score']:['Питьё и входы производства','Расходуемые комплекты: один тратится на ремонт','Заработанный груз: доставка и личный счёт'];
  return <div className="v2-resources">{seat.resources.map((n,i) => { const Icon=ICONS[i]; const reserved=seat.reserved[i]; return <div key={i} data-guide={['water','tools','cargo'][i]} tabIndex={0} aria-label={`${resourceNames[i][language==='en'?1:0]}: ${Math.max(0,n-reserved)} ${language==='en'?'free':'свободно'}, ${reserved} ${language==='en'?'reserved':'в резерве'}. ${purpose[i]}`} title={`${purpose[i]}. ${language==="en"?"Total":"Всего"}: ${n}`}><Icon size={25}/><span><b>{Math.max(0,n-reserved)}</b><span>{resourceNames[i][language==="en"?1:0]}</span></span>{reserved>0&&<small>{reserved} {language==="en"?"reserved":"в резерве"}</small>}</div>; })}</div>;
}
