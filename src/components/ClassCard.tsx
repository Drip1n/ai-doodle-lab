import { useEffect, useRef, useState } from 'react';
import type { ClassDef } from '../types';

interface Props {
  def: ClassDef;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
}

export function ClassCard({ def, count, selected, onSelect, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(def.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== def.name) onRename(draft);
    else setDraft(def.name);
  };

  return (
    <div
      className={`classCard${selected ? ' isSelected' : ''}`}
      style={
        {
          '--accent': def.accent,
          '--accent-soft': def.accentSoft,
        } as React.CSSProperties
      }
    >
      <button type="button" className="classCardBody" onClick={onSelect} aria-pressed={selected}>
        <span className="classEmoji">{def.emoji}</span>
        {editing ? (
          <input
            ref={inputRef}
            className="classNameInput"
            value={draft}
            maxLength={14}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(def.name);
                setEditing(false);
              }
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="className">{def.name}</span>
        )}
        <span className="classCount">
          {count} {count === 1 ? 'example' : 'examples'}
        </span>
        <span className="classPick">{selected ? '✓ Teaching this' : `Teach ${def.name}`}</span>
      </button>
      <button
        type="button"
        className="classRename"
        title="Rename this category"
        aria-label={`Rename ${def.name}`}
        onClick={() => {
          setDraft(def.name);
          setEditing(true);
        }}
      >
        ✏️
      </button>
    </div>
  );
}
