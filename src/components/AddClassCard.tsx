import { useState } from 'react';
import { EmojiPicker } from './EmojiPicker';

interface Props {
  onAdd: (name: string, emoji: string | undefined) => void;
}

export function AddClassCard({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  // No icon by default -- a preset emoji would be a wrong guess at the name.
  const [emoji, setEmoji] = useState<string | undefined>(undefined);

  const reset = () => {
    setOpen(false);
    setName('');
    setEmoji(undefined);
  };

  const submit = () => {
    if (!name.trim()) return;
    onAdd(name, emoji);
    reset();
  };

  if (!open) {
    return (
      <button type="button" className="addClassCard" onClick={() => setOpen(true)}>
        <span className="addClassPlus" aria-hidden="true">
          +
        </span>
        <span>Add something</span>
      </button>
    );
  }

  return (
    <div className="classCard addClassForm">
      <label className="classEditorLabel" htmlFor="new-class-name">
        Name
      </label>
      <input
        id="new-class-name"
        className="classNameInput"
        placeholder="e.g. Robot"
        value={name}
        maxLength={14}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') reset();
        }}
      />

      <p className="classEditorLabel">Icon</p>
      <EmojiPicker value={emoji} onChange={setEmoji} />

      <div className="addClassActions">
        <button type="button" className="btn btnGhost" onClick={reset}>
          Cancel
        </button>
        <button type="button" className="btn btnPrimary" onClick={submit} disabled={!name.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
