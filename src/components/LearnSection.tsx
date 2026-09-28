import { useState } from 'react';

interface Card {
  id: string;
  emoji: string;
  title: string;
  body: React.ReactNode;
}

const CARDS: Card[] = [
  {
    id: 'how',
    emoji: '🧠',
    title: 'How did I teach the AI?',
    body: (
      <p>
        You gave the AI labeled examples. It remembers patterns from those examples and compares new
        drawings with things it has already seen.
      </p>
    ),
  },
  {
    id: 'more',
    emoji: '📚',
    title: 'Why do more examples help?',
    body: (
      <p>
        One cat drawing cannot show every possible cat. Different examples help AI see more
        variations.
      </p>
    ),
  },
  {
    id: 'balance',
    emoji: '⚖️',
    title: 'Balanced data',
    body: (
      <p>
        If AI sees 20 cats but only 2 trees, it has much more experience with cats.
      </p>
    ),
  },
  {
    id: 'trick',
    emoji: '🎭',
    title: 'Can you trick the AI?',
    body: <p>Try drawing something in a strange style. What happens?</p>,
  },
  {
    id: 'experiment',
    emoji: '🧪',
    title: 'Experiment',
    body: (
      <>
        <p>Try:</p>
        <ul>
          <li>a tiny drawing</li>
          <li>a huge drawing</li>
          <li>a different style</li>
          <li>a strange angle</li>
          <li>a very simple drawing</li>
        </ul>
        <p className="learnAsk">What made your AI better?</p>
      </>
    ),
  },
];

export function LearnSection() {
  const [open, setOpen] = useState<string | null>('how');

  return (
    <div className="stage">
      <header className="stageHead">
        <h2 className="stageTitle">What is really happening?</h2>
        <p className="stageSub">
          The AI already has basic computer-vision eyes. You taught it what <em>your</em> categories
          look like by giving it examples.
        </p>
      </header>

      <div className="learnGrid">
        {CARDS.map((card) => {
          const expanded = open === card.id;
          return (
            <article key={card.id} className={`learnCard${expanded ? ' isOpen' : ''}`}>
              <button
                type="button"
                className="learnToggle"
                onClick={() => setOpen(expanded ? null : card.id)}
                aria-expanded={expanded}
              >
                <span className="learnEmoji" aria-hidden="true">
                  {card.emoji}
                </span>
                <span className="learnTitle">{card.title}</span>
                <span className="learnChevron" aria-hidden="true">
                  {expanded ? '−' : '+'}
                </span>
              </button>
              {expanded && <div className="learnBody">{card.body}</div>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
