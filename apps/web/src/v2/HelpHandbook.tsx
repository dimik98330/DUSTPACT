import { useState } from "react";
import {
  Compass,
  Handshake,
  Check,
  ArrowRight,
  Droplets,
  Wrench,
  Package,
  Shield,
  Coins,
  LockKeyhole,
  Send,
  Eye,
  Flag,
  ExternalLink,
} from "lucide-react";
import type { GameView } from "./model";
const topics = [
  {
    icon: Compass,
    title: ["Зачем идти в город", "Why reach the city"],
    hint: ["Общая цель и личный интерес", "Shared goal and personal interest"],
  },
  {
    icon: Handshake,
    title: ["Зачем нужен пакт", "Why make a pact"],
    hint: [
      "Что партнёр даёт и что получит",
      "What each partner gives and receives",
    ],
  },
  {
    icon: Send,
    title: ["Когда отправлять ход", "When to send your move"],
    hint: [
      "От выбора до результата встречи",
      "From a choice to an encounter result",
    ],
  },
  {
    icon: Flag,
    title: ["За что дают очки", "How scoring works"],
    hint: ["Груз, доставка и вклад", "Cargo, delivery and contribution"],
  },
];
export default function HelpHandbook({
  game: g,
  language,
  onPacts,
  onCity,
}: {
  game: GameView;
  language: string;
  onPacts(): void;
  onCity(): void;
}) {
  const [topic, setTopic] = useState(0),
    say = (ru: string, en: string) => (language === "en" ? en : ru),
    word = (pair: string[]) => pair[language === "en" ? 1 : 0];
  return (
    <section className="hb-handbook">
      <div className="hb-heading">
        <span className="dp-kicker">
          {say("Полевой справочник", "Field guide")}
        </span>
        <h3>
          {say(
            "Одна встреча. Один твой ход.",
            "One encounter. One move of your own.",
          )}
        </h3>
        <p>
          {say(
            "Выбери вопрос — справа появится пример из экспедиции.",
            "Choose a question to see an expedition example on the right.",
          )}
        </p>
      </div>
      <div className="hb-layout">
        <div className="hb-topic-column">
          <nav
            className="hb-topics"
            aria-label={say("Вопросы об игре", "Game questions")}
          >
            {topics.map((t, i) => (
              <button
                key={i}
                aria-current={topic === i ? "page" : undefined}
                onClick={() => setTopic(i)}
              >
                <span className="hb-topic-icon">
                  <t.icon size={23} />
                </span>
                <span>
                  <b>{word(t.title)}</b>
                  <small>{word(t.hint)}</small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </nav>
          <div className="hb-training">
            <div>
              <Compass size={24} />
              <span>
                <b>
                  {say(
                    "Первый пакт на практике",
                    "Your first pact in practice",
                  )}
                </b>
                <small>
                  {say(
                    "Обучение без кошелька, в отдельной вкладке",
                    "Learn without a wallet, in a separate tab",
                  )}
                </small>
              </span>
            </div>
            <a
              href={`?version=${g.version}&mode=practice&tutorial=1`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {say("Открыть обучение", "Open learning")}
              <ExternalLink size={17} />
            </a>
          </div>
        </div>
        <div className="hb-example" key={topic}>
          {topic === 0 && (
            <>
              <span className="dp-kicker">
                {say("Цель каравана", "Caravan objective")}
              </span>
              <h4>
                {say(
                  "Довезти добытый груз и сохранить караван",
                  "Deliver earned cargo and keep the caravan intact",
                )}
              </h4>
              <div className="hb-goal">
                <div>
                  <Package size={30} />
                  <b>{g.count}</b>
                  <span>
                    {say(
                      "груза через главные ворота",
                      "cargo through the main gate",
                    )}
                  </span>
                </div>
                <span className="hb-goal-plus">+</span>
                <div>
                  <Shield size={30} />
                  <b>&gt; 0</b>
                  <span>{say("прочности к прибытию", "hull on arrival")}</span>
                </div>
              </div>
              <p>
                {say(
                  "В начале груза нет. Его предстоит добыть по дороге. У города каждый выбирает только одно действие:",
                  "Start with no cargo. Earn it on the journey. At the city, each player chooses just one action:",
                )}
              </p>
              <div className="hb-city-choices">
                <div>
                  <Package />
                  <b>{say("Доставить", "Deliver")}</b>
                  <span>
                    {say(
                      "Отдать свой груз городу",
                      "Give your cargo to the city",
                    )}
                  </span>
                </div>
                <div>
                  <Shield />
                  <b>{say("Охранять", "Guard")}</b>
                  <span>
                    {say("Защитить общий выход", "Protect the shared arrival")}
                  </span>
                </div>
                <div>
                  <Coins />
                  <b>{say("Рынок", "Market")}</b>
                  <span>
                    {say("Получить личный груз", "Gain personal cargo")}
                  </span>
                </div>
              </div>
              <p className="hb-note">
                {say(
                  "Обход требует меньше груза, но отдельных охранников. Охрана и доставка — разные действия: одному не сделать всё.",
                  "The detour needs less cargo but distinct guards. Guarding and delivering are different actions; one player cannot do everything.",
                )}
              </p>
            </>
          )}
          {topic === 0 && g.stage === 5 && g.phase === 1 && (
            <button onClick={onCity}>
              {say("Показать доставку в игре", "Show delivery in the game")}
              <ArrowRight size={18} />
            </button>
          )}
          {topic === 1 && (
            <>
              <span className="dp-kicker">
                {say("Пример · разрушенный колодец", "Example · ruined well")}
              </span>
              <h4>
                {say(
                  "У тебя вода. У Тимура инструмент.",
                  "You have water. Timur has a tool.",
                )}
              </h4>
              <div className="hb-recipe">
                <div>
                  <span>{say("Ты вкладываешь", "You contribute")}</span>
                  <Droplets size={27} />
                  <b>2 {say("воды", "water")}</b>
                </div>
                <span className="hb-recipe-plus">+</span>
                <div>
                  <span>{say("Тимур вкладывает", "Timur contributes")}</span>
                  <Wrench size={27} />
                  <b>1 {say("инструмент", "tool")}</b>
                  <small>
                    {say("и действие ремонта", "and the repair action")}
                  </small>
                </div>
                <ArrowRight className="hb-recipe-arrow" />
                <div className="hb-recipe-output">
                  <span>{say("Выпуск проекта", "Project output")}</span>
                  <Droplets size={27} />
                  <b>8 {say("воды", "water")}</b>
                </div>
              </div>
              <div className="hb-split">
                <span>
                  {say("Тебе", "You")}: <b>4 {say("воды", "water")}</b>
                </span>
                <Handshake size={23} />
                <span>
                  {say("Тимуру", "Timur")}: <b>4 {say("воды", "water")}</b>
                </span>
              </div>
              <div className="hb-comparison">
                <div>
                  <Eye size={21} />
                  <b>{say("На словах", "A promise")}</b>
                  <p>
                    {say(
                      "Можно отдать запасы и довериться. Партнёр ещё может изменить своё действие.",
                      "Transfer supplies and trust the partner. They can still change their action.",
                    )}
                  </p>
                </div>
                <div>
                  <LockKeyhole size={21} />
                  <b>{say("Принятый пакт", "An accepted pact")}</b>
                  <p>
                    {say(
                      "Резервирует точные вклады и закрепляет ремонт. Раздел результата задан заранее.",
                      "Reserves the exact contributions and binds repair. The output split is agreed in advance.",
                    )}
                  </p>
                </div>
              </div>
              <p className="hb-note">
                {say(
                  "Это выпуск проекта до питья и других потерь. Пакт гарантирует вклад, а не общую победу.",
                  "This is project output before drinking and other losses. A pact guarantees a contribution, not shared victory.",
                )}
              </p>
              {g.phase === 1 && (
                <button onClick={onPacts}>
                  <Handshake size={18} />
                  {say("Открыть договоры", "Open pacts")}
                  <ArrowRight size={18} />
                </button>
              )}
              {g.phase !== 1 && (
                <p className="dp-caption">
                  {say(
                    "Новые пакты заключаются на этапе подготовки хода.",
                    "Make new pacts during planning.",
                  )}
                </p>
              )}
            </>
          )}
          {topic === 2 && (
            <>
              <span className="dp-kicker">
                {say("Порядок встречи", "Encounter sequence")}
              </span>
              <h4>
                {say(
                  "Сначала договорись. Затем одобри свой план.",
                  "Negotiate first. Then approve your plan.",
                )}
              </h4>
              <ol className="hb-turn-steps">
                {[
                  [
                    say("Подготовка", "Planning"),
                    say(
                      "Сравни запасы, заключи пакт при необходимости и выбери действие с маршрутом. Нажми «Мой план готов».",
                      "Compare supplies, make a pact if needed and choose your action and route. Press “My plan is ready”.",
                    ),
                  ],
                  [
                    say("Фиксация", "Commitment"),
                    say(
                      "Подпись закрепляет скрытый план. Остальные пока не видят твой свободный выбор.",
                      "Your signature commits a hidden plan. Others cannot yet see your unbound choice.",
                    ),
                  ],
                  [
                    say("Раскрытие", "Reveal"),
                    say(
                      "Раскрой именно сохранённый план. Без раскрытия личный зачёт теряется; принятый пакт остаётся в силе.",
                      "Reveal the exact saved plan. Missing a reveal forfeits personal scoring; an accepted pact remains binding.",
                    ),
                  ],
                  [
                    say("Результат", "Outcome"),
                    say(
                      "Программа исполняет действия и показывает новые запасы. Следующая встреча учитывает эти последствия.",
                      "The program resolves actions and updates supplies. The next encounter carries those consequences forward.",
                    ),
                  ],
                ].map(([title, text], i) => (
                  <li key={i}>
                    <b>{i + 1}</b>
                    <div>
                      <h5>{title}</h5>
                      <p>{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="hb-note">
                {g.network === "practice"
                  ? say(
                      "В обучении подписи пропускаются: после готовности ход сразу рассчитывается локально.",
                      "Learning skips signatures: once ready, your move resolves locally.",
                    )
                  : say(
                      "Без игровой сессии фиксация и раскрытие подписываются вручную. Разрешённая сессия отправляет только выбранный и одобренный ход.",
                      "Without a game session, sign commitment and reveal manually. An authorized session only sends your selected and approved move.",
                    )}
              </p>
            </>
          )}
          {topic === 3 && (
            <>
              <span className="dp-kicker">
                {say("Пример личного результата", "Personal score example")}
              </span>
              <h4>
                {say(
                  "Довезти караван выгодно каждому",
                  "Everyone benefits from arrival",
                )}
              </h4>
              <div className="hb-score-example">
                <div>
                  <Package />
                  <b>2 × 3</b>
                  <span>{say("оставшийся груз", "remaining cargo")}</span>
                </div>
                <span>+</span>
                <div>
                  <Flag />
                  <b>1</b>
                  <span>{say("доставлено", "delivered")}</span>
                </div>
                <span>+</span>
                <div>
                  <Wrench />
                  <b>2</b>
                  <span>{say("вклад", "contribution")}</span>
                </div>
                <span>=</span>
                <div className="hb-score-total">
                  <b>9</b>
                  <span>{say("очков", "points")}</span>
                </div>
              </div>
              <div className="hb-scoring-rules">
                <p>
                  <Wrench size={19} />
                  {say(
                    "Вклад: охрана +1, выполненный ремонт +2, доставка в городе +1 за действие, независимо от количества груза.",
                    "Contribution: guard +1, completed repair +2, city delivery +1 per action regardless of cargo quantity.",
                  )}
                </p>
                <p>
                  <Check size={19} />
                  {say(
                    "Очки сохраняются, если караван прибыл и твой зачёт не потерян.",
                    "Keep points if the caravan arrives and your score is not forfeited.",
                  )}
                </p>
                <p>
                  <Droplets size={19} />
                  {say(
                    "Вода и инструменты очков не дают. Они нужны для работ и выживания.",
                    "Water and tools give no direct points. They fund work and survival.",
                  )}
                </p>
                <p>
                  <Shield size={19} />
                  {say(
                    "Если общего прибытия нет, личный итог у всех — 0.",
                    "If shared arrival fails, everyone’s final score is 0.",
                  )}
                </p>
              </div>
              <p className="hb-note">
                {say(
                  "Заработанная оплата TEST-миссии проверяется отдельно. Она не является игровыми очками.",
                  "Earned TEST mission payment is checked separately. It is not game score.",
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
