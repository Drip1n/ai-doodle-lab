import type { Stage } from '../types';

const STEPS: { id: Stage; label: string }[] = [
  { id: 'teach', label: 'Teach' },
  { id: 'challenge', label: 'Challenge' },
  { id: 'learn', label: 'Learn' },
];

interface Props {
  stage: Stage;
  onChange: (stage: Stage) => void;
}

export function Stepper({ stage, onChange }: Props) {
  return (
    <nav className="stepper" aria-label="Workshop stages">
      {STEPS.map((step, index) => (
        <button
          key={step.id}
          type="button"
          className={`step${stage === step.id ? ' isActive' : ''}`}
          onClick={() => onChange(step.id)}
          aria-current={stage === step.id ? 'step' : undefined}
        >
          <span className="stepNumber">{index + 1}</span>
          <span className="stepLabel">{step.label}</span>
        </button>
      ))}
    </nav>
  );
}
