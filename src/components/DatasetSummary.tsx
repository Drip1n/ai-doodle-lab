import type { ClassDef, ClassId } from '../types';

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
              <span aria-hidden="true">{def.emoji}</span> {def.name}
            </span>
            <span className="datasetBarTrack">
              <span
                className="datasetBarFill"
                style={{
                  width: `${(counts[def.id] / max) * 100}%`,
                  background: def.accent,
                }}
              />
            </span>
            <span className="datasetValue">{counts[def.id]}</span>
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
