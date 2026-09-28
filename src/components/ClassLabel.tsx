import type { LearningClass } from '../types';

/**
 * One place that decides how a category is written out, so a category with
 * no icon simply reads as its name -- never a gap, a box or a fallback glyph.
 */
export function ClassLabel({
  def,
  uppercase = false,
}: {
  def: Pick<LearningClass, 'name' | 'emoji'>;
  uppercase?: boolean;
}) {
  return (
    <>
      {def.emoji ? (
        <span className="classLabelIcon" aria-hidden="true">
          {def.emoji}
        </span>
      ) : null}
      <span className="classLabelName">{uppercase ? def.name.toUpperCase() : def.name}</span>
    </>
  );
}
