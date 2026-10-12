import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { createWorld, type WorldController, type WorldCast, type InteractionId, type CharacterModel } from "../world/createWorld";
import type { GameView } from "./model";
import { receiptKey } from "./model";
import { useI18n } from "../../../../packages/ui/src/i18n";
import { words } from "./content";
const IDS = ["aisha", "timur", "saya", "nura", "alan"] as const;
const MODELS: CharacterModel[] = ["Rogue_Hooded", "Knight", "Mage", "Barbarian", "Rogue_Hooded", "Knight"];
export default function Scene({ game, paused, viewOnly=false, onInteract, onNearby }: {
  game?: GameView; paused: boolean; viewOnly?:boolean; onInteract(id: InteractionId): void; onNearby(id: InteractionId | null): void;
}) {
  const { language } = useI18n();
  const say = (ru: string, en: string) => words(language, [ru,en]);
  const host = useRef<HTMLDivElement>(null), controller = useRef<WorldController | null>(null);
  const interaction = useRef(onInteract), nearby = useRef(onNearby), stopped = useRef(paused||viewOnly);
  interaction.current = onInteract; nearby.current = onNearby; stopped.current = paused||viewOnly;
  const cameraLabel=viewOnly?say("Наблюдение за 3D-экспедицией: перетаскивание — камера, колёсико или щипок — масштаб.","Watch the 3D expedition: drag to orbit; wheel or pinch to zoom."):say("3D-экспедиция: WASD или стрелки — идти, перетаскивание — камера, E — взаимодействие.", "3D expedition: WASD or arrows to walk, drag to orbit, E to interact.");
  const [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const seat = game?.seat ?? 0, count = game?.count ?? 4;
  const otherSeats = Array.from({length: count}, (_, i) => i).filter(i => i !== seat);
  const cast = useMemo<WorldCast>(() => ({ hero: MODELS[seat], companions: otherSeats.map((i, p) => ({id: IDS[p], model: MODELS[i]})) }), [seat,count]);
  const stage = game?.stage ?? 0;
  const last = game?.history.at(-1), lastKey = last && game ? receiptKey(game.match,last) : "";
  const seen = useRef(lastKey), shownStage = useRef(stage);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setError("");
    if (!host.current) return;
    void createWorld(host.current, {
      ariaLabel: cameraLabel,
      onReady: () => { if (!cancelled) setLoaded(true); },
      onError: message => { if (!cancelled) setError(message); },
      onNearby: id => { if (!cancelled) nearby.current(id); },
      onInteract: id => {if(!viewOnly)interaction.current(id);},
      onProgress: label => { if (!cancelled) setProgress(label); },
    }, stage, cast, { encounters: true }).then(c => {
      if (cancelled) c.dispose();
      else { controller.current = c; c.setPaused(stopped.current); shownStage.current = stage; }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; controller.current?.dispose(); controller.current = null; };
  }, [cast,viewOnly]);
  useEffect(() => { controller.current?.setPaused(paused||viewOnly); }, [paused,viewOnly,loaded]);
  useEffect(() => {
    controller.current?.setAccessibleLabel(cameraLabel);
  }, [language,viewOnly,loaded]);
  useEffect(() => {
    const c = controller.current;
    if (!c || !loaded) return;
    let stale = false;
    if (last && lastKey !== seen.current) {
      seen.current = lastKey;
      const order = [seat, ...otherSeats];
      c.setEncounterOutcome?.(last.objective);
      void c.playResolution({ guard: last.defense, threat: last.threat, hullBefore: last.hullBefore, hullAfter: last.hullAfter, actions: order.map(i => last.actions[i] ?? 0) }).then(() => {
        if (!stale && shownStage.current !== stage) { c.setStage(stage); shownStage.current = stage; }
        c.setPaused(stopped.current);
      });
    } else if (shownStage.current !== stage) { c.setStage(stage); shownStage.current = stage; }
    c.setObjective(stage === 0 ? "water" : stage === 2 ? "salvage" : "gate");
    return () => { stale = true; };
  }, [stage,lastKey,loaded]);
  function joystick(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.getBoundingClientRect();
    controller.current?.setJoystick(Math.max(-1,Math.min(1,(event.clientX-box.left-box.width/2)/(box.width/2))), Math.max(-1,Math.min(1,(event.clientY-box.top-box.height/2)/(box.height/2))));
  }
  return <>
    <div className="v2-world" ref={host} data-testid="v2-world" />
    {!loaded && !error && <div className="v2-scene-loading" role="status"><span className="v2-spinner" />{say("Готовим экспедицию…", "Preparing the expedition…")}<small>{language === "ru" ? progress : "Loading animated characters and landscape"}</small></div>}
    {error && <div className="v2-scene-error" role="alert">{viewOnly?say("3D-мир не загрузился. Снимок Solana доступен в панели.","The 3D world could not load. The Solana snapshot remains in the panel."):say("3D-мир не загрузился. Игровые действия доступны в панели.", "The 3D world could not load. Game actions remain available in the panel.")}<details><summary>{say("Подробности", "Details")}</summary>{error}</details></div>}
    {(!paused||viewOnly) && loaded && <div className="v2-world-controls">
      {!viewOnly&&<button className="v2-joystick" aria-label={say("Джойстик движения — удерживайте и перетаскивайте", "Movement joystick — hold and drag")} onPointerDown={joystick} onPointerMove={e => { if(e.buttons) joystick(e); }} onPointerUp={() => controller.current?.setJoystick(0,0)} onPointerCancel={() => controller.current?.setJoystick(0,0)}><span /></button>}
      <span className="v2-controls-help">{!viewOnly&&'WASD · '}{say("камера мышью", "drag to orbit")}</span>
      <button className="v2-icon" aria-label={say("Вернуть камеру", "Reset camera")} onClick={() => controller.current?.resetCamera()}><RotateCcw size={22} /></button>
    </div>}
  </>;
}
