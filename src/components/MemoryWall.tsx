import type { ClassDef, ClassId, Example } from '../types';
import { ClassLabel } from './ClassLabel';

interface Props {
  classes: ClassDef[];
  counts: Record<ClassId, number>;
  examples: Example[];
}

const MAX_THUMBNAILS = 8;

export function MemoryWall({ classes, counts, examples }: Props) {
  const total = examples.length;
  const max = Math.max(...classes.map((c) => counts[c.id]));
  const laggingClass = total > 0 ? classes.find((c) => counts[c.id] * 2 < max) : undefined;

  return (
    <section className="panel">
      <h3 className="panelTitle">What your AI has learned</h3>

      {total === 0 && (
        <p className="emptyNote">
          Nothing yet. Every example you teach shows up here as a little memory. 🧠
        </p>
      )}

      {classes.map((def) => {
        const own = examples.filter((example) => example.classId === def.id).slice(-MAX_THUMBNAILS);
        return (
          <div key={def.id} className="memoryGroup">
            <p className="memoryHeading">
              <ClassLabel def={def} />
              <span className="memoryCount" style={{ background: def.accentSoft, color: def.accent }}>
                {counts[def.id]} {counts[def.id] === 1 ? 'example' : 'examples'}
              </span>
            </p>
            {own.length === 0 ? (
              <p className="memoryEmpty">No examples yet</p>
            ) : (
              <div className="memoryStrip">
                {own.map((example) => (
                  <img
                    key={example.id}
                    src={example.thumbnail}
                    alt={`${def.name} example`}
                    className="memoryThumb"
                    style={{ borderColor: def.accent }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {laggingClass && (
        <p className="memoryTip">
          Your AI has seen fewer {laggingClass.name}s. Try teaching it more{' '}
          {laggingClass.emoji ?? '✏️'}
        </p>
      )}
    </section>
  );
}
