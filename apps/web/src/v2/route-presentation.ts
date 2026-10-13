import type { GameView } from "./model";
import type { Text } from "./content";
/** Route votes are distinct from actions: neither assigns repair nor cancels accepted work. */
export function routePresentation(
  g: GameView,
): Array<{ title: Text; effect: Text }> {
  const n = g.count;
  const rows: Array<Array<{ title: Text; effect: Text }>> = [
    [
      {
        title: ["Через колодец", "Via the well"],
        effect: [
          "Каждый пьёт 1 воду. Если никто не восстановит колодец, караван теряет ещё 2 прочности.",
          "Each drinks 1 water. Without a restored well, lose 2 extra hull.",
        ],
      },
      {
        title: ["Обойти колодец", "Bypass the well"],
        effect: [
          "Каждый пьёт 2 воды. Штрафа за сломанный колодец нет; принятый проект всё равно исполнится.",
          "Each drinks 2 water. No broken-well penalty; an accepted project still executes.",
        ],
      },
    ],
    [
      {
        title: ["Через мост", "Cross the bridge"],
        effect: [
          `Нужны ${Math.ceil(n / 2)} ремонта: 1 вода на каждого и до 2 мест добычи дальше. Без ремонта: 2 воды и −4 прочности.`,
          `Need ${Math.ceil(n / 2)} repairs: 1 water each and up to 2 later extraction slots. Otherwise: 2 water and −4 hull.`,
        ],
      },
      {
        title: ["В обход", "Take the detour"],
        effect: [
          "Каждый пьёт 2 воды. Ремонты не обязательны; дальше только 1 место добычи.",
          "Each drinks 2 water. Repairs optional; only 1 later extraction slot.",
        ],
      },
    ],
    [
      {
        title: ["Осторожная добыча", "Cautious extraction"],
        effect: [
          `6 груза на проект; угроза ${n - 2}.`,
          `6 cargo per project; threat ${n - 2}.`,
        ],
      },
      {
        title: ["Рискованная добыча", "Risky extraction"],
        effect: [
          `8 груза на проект; угроза ${n}.`,
          `8 cargo per project; threat ${n}.`,
        ],
      },
    ],
    [
      {
        title: ["Осторожный проход", "Cautious passage"],
        effect: [
          `Угроза ${n + 2}. Охрана даёт 2 защиты; добычу инструментов выбирают отдельным действием.`,
          `Threat ${n + 2}. Guard adds 2 defense; tool recovery is a separate action.`,
        ],
      },
      {
        title: ["Опасный проход", "Dangerous passage"],
        effect: [
          `Угроза ${n + 4}, без добавочной добычи. Неприкрытый урон отнимает груз и прочность.`,
          `Threat ${n + 4}, no extra loot. Uncovered damage takes cargo and hull.`,
        ],
      },
    ],
    [],
    [
      {
        title: ["Через городские ворота", "Through the gates"],
        effect: [
          `Доставьте ${n} груза. Обязательного эскорта и боевой угрозы нет.`,
          `Deliver ${n} cargo. No mandatory escorts or combat threat.`,
        ],
      },
      {
        title: ["Опасный обход", "Dangerous detour"],
        effect: [
          `Доставьте ${Math.ceil(n / 2)} груза и назначьте ${Math.ceil(n / 2)} разных охранников. Угроза ${n + 4}.`,
          `Deliver ${Math.ceil(n / 2)} cargo with ${Math.ceil(n / 2)} distinct guards. Threat ${n + 4}.`,
        ],
      },
    ],
  ];
  return rows[g.stage] ?? [];
}
