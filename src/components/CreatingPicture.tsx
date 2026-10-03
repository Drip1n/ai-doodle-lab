/**
 * The waiting state for a real image generation.
 *
 * A generation can take most of a minute, and in the workshop children read a
 * still screen as "it is broken" and press the button again. So this is
 * deliberately alive: sparkles drift, a brush wobbles, three dots travel.
 *
 * What it is not: a progress bar. The backend cannot see how far along the
 * provider is, so there is no percentage and no invented stage — claiming
 * "35%" or "adding colour" would be a lie a child would believe.
 *
 * Everything here is readable standing still. The animation is pure CSS on
 * top of a complete static layout, so `prefers-reduced-motion` (which the
 * stylesheet honours globally) removes the movement and nothing else.
 */
export function CreatingPicture({ replacing = false }: { replacing?: boolean }) {
  return (
    <div className={`creating${replacing ? ' isReplacing' : ''}`}>
      <span className="creatingStage" aria-hidden="true">
        <span className="creatingBrush">🖌️</span>
        <span className="creatingSparkle creatingSparkle1">✨</span>
        <span className="creatingSparkle creatingSparkle2">⭐</span>
        <span className="creatingSparkle creatingSparkle3">🌟</span>
      </span>
      <p className="creatingTitle" role="status">
        🎨 Creating your picture…
      </p>
      <p className="creatingHint">
        {replacing
          ? 'Your new picture is on its way. The one you already made stays here until it arrives.'
          : 'Lots of pictures may be on their way, so this can take a minute.'}
      </p>
      <span className="creatingDots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
