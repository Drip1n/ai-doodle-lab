import { EMOJI_PRESETS } from '../types';

interface Props {
  value: string | undefined;
  onChange: (emoji: string | undefined) => void;
}

export function EmojiPicker({ value, onChange }: Props) {
  return (
    <div className="emojiPickerWrap">
      <button
        type="button"
        className={`noIconOption${!value ? ' isActive' : ''}`}
        onClick={() => onChange(undefined)}
        aria-pressed={!value}
      >
        No icon
      </button>
      <div className="emojiPicker" role="group" aria-label="Choose an icon">
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
    </div>
  );
}
