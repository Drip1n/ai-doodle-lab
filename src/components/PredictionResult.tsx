import type { ClassDef, ClassId, Prediction } from '../types';

interface Props {
  prediction: Prediction;
  classes: ClassDef[];
}

export function PredictionResult({ prediction, classes }: Props) {
  const winner = classes.find((def) => def.id === prediction.classId) ?? classes[0];
  const ordered = [...classes].sort(
    (a, b) => prediction.confidences[b.id] - prediction.confidences[a.id],
  );

  const percent = (id: ClassId) => Math.round(prediction.confidences[id] * 100);

  return (
    <div className="prediction">
      <p className="predictionLead">🤖 I think it&rsquo;s…</p>
      <p className="predictionWinner" style={{ color: winner.accent }}>
        <span aria-hidden="true">{winner.emoji}</span> {winner.name.toUpperCase()}
        <span className="predictionPercent">{percent(winner.id)}%</span>
      </p>

      <ul className="confidenceList">
        {ordered.map((def) => (
          <li key={def.id} className="confidenceRow">
            <span className="confidenceLabel">
              <span aria-hidden="true">{def.emoji}</span> {def.name}
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
        These numbers come from how many of the closest examples the AI remembers belong to each
        category.
      </p>
    </div>
  );
}
