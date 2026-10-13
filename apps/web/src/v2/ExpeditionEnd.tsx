import { ArrowRight, Flag } from 'lucide-react';

/** The completed journey has one next step; scoring details belong in the result. */
export default function ExpeditionEnd({ arrived, language, onResult }: {
  arrived: boolean; language: string; onResult(): void;
}) {
  const say = (ru: string, en: string) => language === 'en' ? en : ru;
  return <section className="expedition-end" aria-labelledby="expedition-end-title">
    <span className="expedition-end-icon" aria-hidden="true"><Flag size={28}/></span>
    <div className="expedition-end-copy">
      <span>{say('Путь завершён', 'Journey complete')}</span>
      <h2 id="expedition-end-title">{arrived ? say('Караван прибыл', 'The caravan arrived') : say('Караван не дошёл', 'The caravan did not arrive')}</h2>
      <p>{arrived ? say('Узнай свой результат и вклад команды.', 'See your score and the team’s contribution.') : say('Посмотри, чего не хватило для прибытия.', 'See what the caravan needed to arrive.')}</p>
    </div>
    <button onClick={onResult}>{say('Посмотреть итог', 'View result')}<ArrowRight size={20} aria-hidden="true"/></button>
  </section>;
}
