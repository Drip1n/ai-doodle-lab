import { EMOJI_PRESETS } from '../types';

interface Props {
  value: string;
  onChange: (emoji: string) => void;
}

export function EmojiPicker({ value, onChange }: Props) {
  return (
    <div className="emojiPicker" role="group" aria-label="Choose an emoji">
      {EMOJI_PRESETS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className={`emojiOption${emoji === value ? ' isActive' : ''}`}
          onClick={() => onChange(emoji)}
          aria-pressed={emoji === value}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
