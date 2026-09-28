import { useState } from 'react';
import { EMOJI_PRESETS } from '../types';
import { EmojiPicker } from './EmojiPicker';

interface Props {
  onAdd: (name: string, emoji: string) => void;
}

export function AddClassCard({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI_PRESETS[0]);

  const reset = () => {
    setOpen(false);
    setName('');
    setEmoji(EMOJI_PRESETS[0]);
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

      <p className="classEditorLabel">Emoji</p>
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
