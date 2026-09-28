import type { ClassDef, ClassId } from '../types';

interface Props {
  classes: ClassDef[];
  counts: Record<ClassId, number>;
  total: number;
}

/** Short, friendly feedback that reacts to the shape of the child's dataset. */
function datasetTip(
  classes: ClassDef[],
  counts: Record<ClassId, number>,
  total: number,
): { emoji: string; text: string } {
  if (total === 0) {
    return {
      emoji: '👋',
      text: 'Your AI knows none of your categories yet. Teach it something!',
    };
  }

  const values = classes.map((def) => counts[def.id]);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const thin = classes.find((def) => counts[def.id] < 3);
  if (thin) {
    return {
      emoji: thin.emoji,
      text: `Give the AI a few different examples of ${thin.name}.`,
    };
  }

  if (max > min * 2) {
    return {
      emoji: '⚖️',
      text: 'Your dataset is unbalanced. Try teaching the smaller classes too.',
    };
  }

  if (min >= 5) {
    return {
      emoji: '🚀',
      text: 'Nice! Now test whether your AI works on NEW drawings.',
    };
  }

  return {
    emoji: '💡',
    text: 'Try different sizes and styles so the AI sees more variety.',
  };
}

export function Coach({ classes, counts, total }: Props) {
  const tip = datasetTip(classes, counts, total);
  return (
    <p className="coach">
      <span className="coachEmoji" aria-hidden="true">
        {tip.emoji}
      </span>
      {tip.text}
    </p>
  );
}
