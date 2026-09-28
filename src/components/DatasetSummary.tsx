import type { ClassDef, ClassId } from '../types';
import { ClassLabel } from './ClassLabel';

interface Props {
  classes: ClassDef[];
  counts: Record<ClassId, number>;
  total: number;
  title?: string;
}

export function DatasetSummary({ classes, counts, total, title = 'Your dataset' }: Props) {
  const max = Math.max(1, ...classes.map((c) => counts[c.id] ?? 0));

  return (
    <section className="panel">
      <h3 className="panelTitle">{title}</h3>
      <ul className="datasetList">
        {classes.map((def) => (
          <li key={def.id} className="datasetRow">
            <span className="datasetLabel">
              <ClassLabel def={def} />
            </span>
            <span className="datasetBarTrack">
              <span
                className="datasetBarFill"
                style={{
                  width: `${((counts[def.id] ?? 0) / max) * 100}%`,
                  background: def.accent,
                }}
              />
            </span>
            <span className="datasetValue">{counts[def.id] ?? 0}</span>
          </li>
        ))}
      </ul>
      <p className="datasetTotal">
        <strong>Total</strong>
        <span>
          {total} {total === 1 ? 'example' : 'examples'}
        </span>
      </p>
    </section>
  );
}
