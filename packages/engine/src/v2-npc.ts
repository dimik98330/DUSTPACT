/** Public preferences, not role bonuses or predictions of human moves. */
export type V2Personality='supplier'|'builder'|'trader';
export const V2_PERSONALITIES:readonly V2Personality[]=['supplier','supplier','builder','trader','supplier','builder'];
export const v2ToolAsk=(seat:number,npc=false)=>npc&&V2_PERSONALITIES[seat]==='trader'?3:1;
export function v2BridgePreference(seat:number):readonly [string,string]{
 const kind=V2_PERSONALITIES[seat];
 return kind==='builder'?['Строитель ремонтирует, пока нужны работы и есть свободный комплект. Договор закрепляет его вклад, даже если он позже отключится.','A builder repairs while work is needed and a free kit is available. A pact binds that contribution even after disconnect.']:kind==='trader'?['Торговец бережёт комплект для добычи. За 3 воды готов продать один комплект; ремонт потом выбираешь и выполняешь ты.','The trader keeps a kit for extraction. Three water can buy one kit; you then choose and perform the repair.']:['Поставщик обычно ищет воду и бережёт комплект; при критической прочности меняет приоритет. Заказ ремонта меняет его действие и резервирует комплект.','The supplier usually gathers water and keeps the kit; critical hull changes its priority. A repair order changes its action and reserves the kit.'];
}
