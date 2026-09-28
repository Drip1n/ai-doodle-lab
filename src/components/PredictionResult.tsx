import type { ClassDef, ClassId, Prediction } from '../types';
import { ClassLabel } from './ClassLabel';

interface Props {
  prediction: Prediction;
  classes: ClassDef[];
}

export function PredictionResult({ prediction, classes }: Props) {
  const winner = classes.find((def) => def.id === prediction.classId);
  if (!winner) return null;

  const ordered = [...classes].sort(
    (a, b) => (prediction.confidences[b.id] ?? 0) - (prediction.confidences[a.id] ?? 0),
  );

  const percent = (id: ClassId) => Math.round((prediction.confidences[id] ?? 0) * 100);

  return (
    <div className="prediction">
      <p className="predictionLead">🤖 I think it&rsquo;s…</p>
      <p className="predictionWinner" style={{ color: winner.accent }}>
        <ClassLabel def={winner} uppercase />
        <span className="predictionPercent">{percent(winner.id)}%</span>
      </p>

      <ul className="confidenceList">
        {ordered.map((def) => (
          <li key={def.id} className="confidenceRow">
            <span className="confidenceLabel">
              <ClassLabel def={def} />
            </span>
            <span className="confidenceTrack">
              <span
                className="confidenceFill"
                style={{ width: `${percent(def.id)}%`, background: def.accent }}
              />
            </span>
            <span className="confidenceValue">{percent(def.id)}%</span>
          </li>
        ))}
      </ul>
      <p className="confidenceNote">
        These are match scores, not certainty: they come from how many of the closest examples the
        AI remembers belong to each category.
      </p>
    </div>
  );
}
