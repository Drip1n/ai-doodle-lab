import { useEffect, useRef, useState } from 'react';
import type { ClassDef } from '../types';
import { EmojiPicker } from './EmojiPicker';

interface Props {
  def: ClassDef;
  count: number;
  selected: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onChangeEmoji: (emoji: string) => void;
  onRequestDelete: () => void;
}

export function ClassCard({
  def,
  count,
  selected,
  canDelete,
  onSelect,
  onRename,
  onChangeEmoji,
  onRequestDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(def.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitName = () => {
    if (draft.trim() && draft.trim() !== def.name) onRename(draft);
    else setDraft(def.name);
  };

  return (
    <div
      className={`classCard${selected ? ' isSelected' : ''}${editing ? ' isEditing' : ''}`}
      style={
        {
          '--accent': def.accent,
          '--accent-soft': def.accentSoft,
        } as React.CSSProperties
      }
    >
      <button
        type="button"
        className="classCardBody"
        onClick={onSelect}
        aria-pressed={selected}
        disabled={editing}
      >
        <span className="classEmoji">{def.emoji}</span>
        <span className="className">{def.name}</span>
        <span className="classCount">
          {count} {count === 1 ? 'example' : 'examples'}
        </span>
        <span className="classPick">{selected ? '✓ Teaching this' : `Teach ${def.name}`}</span>
      </button>

      <button
        type="button"
        className="classRename"
        title={editing ? 'Close editor' : `Edit ${def.name}`}
        aria-label={editing ? 'Close editor' : `Edit ${def.name}`}
        aria-expanded={editing}
        onClick={() => {
          setDraft(def.name);
          setEditing((value) => !value);
        }}
      >
        {editing ? '✕' : '✏️'}
      </button>

      {editing && (
        <div className="classEditor">
          <label className="classEditorLabel" htmlFor={`class-name-${def.id}`}>
            Name
          </label>
          <input
            id={`class-name-${def.id}`}
            ref={inputRef}
            className="classNameInput"
            value={draft}
            maxLength={14}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitName();
                inputRef.current?.blur();
              }
              if (event.key === 'Escape') {
                setDraft(def.name);
                setEditing(false);
              }
            }}
          />

          <p className="classEditorLabel">Emoji</p>
          <EmojiPicker value={def.emoji} onChange={onChangeEmoji} />

          <button
            type="button"
            className="classDeleteBtn"
            onClick={onRequestDelete}
            disabled={!canDelete}
            title={canDelete ? undefined : 'Keep at least two categories'}
          >
            🗑️ Delete category
          </button>
        </div>
      )}
    </div>
  );
}
