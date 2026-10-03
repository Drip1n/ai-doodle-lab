import { useEffect, useRef, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import { IMAGE_MODE, IMAGE_ENDPOINT, IMAGE_TIMEOUT_MS, requestImage } from '../generative/imageApi';
import { downloadImage, pictureFileName } from '../generative/downloadImage';
import { CreatingPicture } from './CreatingPicture';
import { PhoneShare } from './PhoneShare';

const PROMPT_GROUPS = [
  { id: 'look', title: 'Choose its look', emoji: '🎨', options: [
    { label: 'Classic', text: 'a classic appearance that suits the object', emoji: '🌿' },
    { label: 'Rainbow', text: 'rainbow colours', emoji: '🌈' },
    { label: 'Ocean blue', text: 'ocean blue colours', emoji: '💙' },
    { label: 'Golden', text: 'golden colours', emoji: '☀️' },
  ] },
  { id: 'world', title: 'Choose a world', emoji: '🌍', options: [
    { label: 'Enchanted forest', text: 'in an enchanted forest', emoji: '🌲' },
    { label: 'On the moon', text: 'on the Moon', emoji: '🌙' },
    { label: 'By the ocean', text: 'beside the ocean', emoji: '🌊' },
    { label: 'Flower garden', text: 'in a flower garden', emoji: '🌸' },
  ] },
  { id: 'style', title: 'Choose a style', emoji: '✨', options: [
    { label: 'Realistic', text: 'realistic style', emoji: '📷' },
    { label: 'Cartoon', text: 'cartoon style', emoji: '✏️' },
    { label: 'Painting', text: 'painting style', emoji: '🎨' },
    { label: '3D toy', text: '3D toy style', emoji: '🧸' },
  ] },
] as const;


export function CreateChallenge({ lab, onGoToTeach }: { lab: AiLab; onGoToTeach: () => void }) {
  const [selectedId, setSelectedId] = useState('');
  const [choices, setChoices] = useState<Record<string, number>>({});
  const complete = PROMPT_GROUPS.every((group) => choices[group.id] !== undefined);
  const idea = complete ? PROMPT_GROUPS.map((group) => group.options[choices[group.id]].text).join(', ') : '';
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workshopCode, setWorkshopCode] = useState('');
  const [codeVisible, setCodeVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const live = IMAGE_MODE === 'live';
  const available = lab.classes.filter((item) => (lab.counts[item.id] ?? 0) > 0);
  const selected = available.find((item) => item.id === selectedId) ?? available[0];
  const examples = lab.examples.filter((item) => item.classId === selected?.id).slice(0, 4);
  const prompt = selected ? `Create a picture of my ${selected.name.toLowerCase()}: ${idea}.` : '';
  /**
   * The picture itself belongs to the session, not to this panel: a child who
   * switches to Memory and back must find it still here. Its caption comes
   * from the snapshot stored with it, never from the choices currently on
   * screen, so changing a look cannot relabel an older picture.
   */
  const picture = lab.latestCreation;

  useEffect(() => () => active.current?.abort(), []);

  /**
   * What a new choice resets: the messages and the demo-mode idea preview.
   * Deliberately NOT the picture the child already made — losing it because
   * they pressed "Ocean blue" to see what it would do was the single most
   * confusing thing in the workshop.
   */
  const clearMessages = () => {
    setPreview(false);
    setError(null);
    setSaveError(null);
  };

  /** The picture stays on screen either way; only the message changes. */
  const download = async () => {
    if (!picture || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await downloadImage(picture.image, pictureFileName(picture.categoryName));
    } catch {
      setSaveError('The picture could not be saved. Try again, or press and hold the picture to save it.');
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!selected || !idea.trim() || active.current) return;
    if (!live) { setPreview(true); return; }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setPreview(false);
    // The previous picture is untouched here. It is replaced only once a new
    // one has really arrived, so a failed or slow attempt never leaves a
    // child staring at an empty panel.
    const timeout = window.setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      const result = await requestImage({
        category: { id: selected.id, name: selected.name },
        idea: idea.trim(),
        style: (['realistic', 'cartoon', 'painting', 'toy'] as const)[choices.style],
        references: examples.map((item) => item.thumbnail),
      }, controller.signal, workshopCode);
      if (active.current !== controller) return;
      lab.rememberCreation({
        image: result.image,
        categoryId: selected.id,
        categoryName: selected.name,
        prompt,
        sharePath: result.sharePath,
        shareExpiresAt: result.shareExpiresAt,
      });
    } catch (cause) {
      if (active.current !== controller) return;
      setError(controller.signal.aborted ? 'That took too long. Please try again.' : cause instanceof Error ? cause.message : 'The picture could not be made. Please try again.');
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  };

  if (!selected) return (
    <section className="panel lockPanel">
      <p className="lockEmoji" aria-hidden="true">🎨</p>
      <h3>Your adventure starts with a drawing</h3>
      <p>Teach your AI with a few examples first. Then choose one of your categories and imagine something new!</p>
      <button type="button" className="btn btnPrimary" onClick={onGoToTeach}>✏️ Let's teach the AI</button>
    </section>
  );

  return (
    <div className="createWorkshop">
      <p className="createNotice">{live ? '🎨 Picture making · Your idea and the drawing clues shown below are sent to an image-making service when you press Create.' : '🛠️ Demo mode · Explore your idea here. No image is generated and nothing is sent online.'}</p>
      {live && !IMAGE_ENDPOINT && <p className="createNotice" role="status">Picture making is not connected yet. Ask your workshop teacher to set it up.</p>}
      <div className="createColumns">
        <section className="panel createEditor">
          <h3><span className="createNumber">1</span> Choose your inspiration</h3>
          <p className="createMuted">Start with something you have already taught your AI.</p>
          <div className="createCategories" aria-label="Choose a learned category">
            {lab.classes.map((item) => {
              const count = lab.counts[item.id] ?? 0;
              return <button type="button" key={item.id} disabled={!count}
                aria-pressed={selected.id === item.id}
                className={`createCategory${selected.id === item.id ? ' isSelected' : ''}`}
                onClick={() => { clearMessages(); setSelectedId(item.id); }}>
                <span aria-hidden="true">{item.emoji ?? '✏️'}</span><strong>{item.name}</strong>
                <small>{count ? `${count} example${count === 1 ? '' : 's'}` : 'Teach me first'}</small>
              </button>;
            })}
          </div>
          <div className="createReferences">
            <strong>Your drawing clues</strong>
            <div className="createThumbnails">{examples.map((item, index) => <img key={item.id} src={item.thumbnail} alt={`${selected.name} example ${index + 1}`} />)}</div>
            <p className="createMuted">{live ? 'These examples guide' : 'These examples would guide'} how your {selected.name.toLowerCase()} looks.</p>
          </div>
          <h3><span className="createNumber">2</span> Create your AI picture</h3>
          <p className="createMuted">Pick one option from each group. Your {selected.name.toLowerCase()} stays the star!</p>
          {PROMPT_GROUPS.map((group) => (
            <fieldset className="createChoiceGroup" key={group.id}>
              <legend>{group.emoji} {group.title}</legend>
              <div className="createChoiceOptions">
                {group.options.map((option, index) => (
                  <button type="button" key={option.label}
                    aria-pressed={choices[group.id] === index}
                    className={`createChoice${choices[group.id] === index ? ' isSelected' : ''}`}
                    onClick={() => { clearMessages(); setChoices((previous) => ({ ...previous, [group.id]: index })); }}>
                    <span aria-hidden="true">{option.emoji}</span> {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="createPromptSummary" aria-live="polite">
            <strong>✨ Your picture prompt</strong>
            <p>{complete ? prompt : `Choose a look, a world and a style (${Object.keys(choices).length}/3 chosen).`}</p>
          </div>
          <p className="createMuted">Change one choice to see how the same subject can look different!</p>
          {/* Hidden by default, because the code is on the board for the whole
              class. The toggle exists because a child who mistypes eight
              characters they cannot see has no way to find out why. */}
          {live && <>
            <label htmlFor="workshop-code">🔑 Workshop code</label>
            <div className="createCodeField">
              <input id="workshop-code" type={codeVisible ? 'text' : 'password'} className="createInput"
                autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={128}
                value={workshopCode} onChange={(event) => setWorkshopCode(event.target.value)}
                placeholder="Ask your teacher" />
              <button type="button" className="createCodeToggle"
                aria-pressed={codeVisible}
                aria-label={codeVisible ? 'Hide the workshop code' : 'Show the workshop code'}
                aria-controls="workshop-code"
                onClick={() => setCodeVisible((shown) => !shown)}>
                <span aria-hidden="true">{codeVisible ? '🙈' : '👁️'}</span>
                <span className="createCodeToggleText">{codeVisible ? 'Hide' : 'Show'}</span>
              </button>
            </div>
          </>}
          <button type="button" className="btn btnPrimary createAction" disabled={!idea.trim() || busy || (live && (!IMAGE_ENDPOINT || !workshopCode.trim()))} onClick={() => void create()}>{busy ? '🎨 Creating your picture…' : live ? '✨ Create my picture' : '✨ Preview my idea'}</button>
          {error && <p role="alert" className="createMuted">{error}</p>}
          <button type="button" className="btn btnGhost" onClick={onGoToTeach}>Want a new subject? Teach it first →</button>
        </section>
        <section className="panel createResult" aria-live="polite">
          <h3><span className="createNumber">3</span> Discover something new</h3>
          <div className="createPaper" aria-busy={busy}>
            {picture ? <>
              <div className="createPictureFrame">
                <img className="createGeneratedImage" src={picture.image} alt={picture.prompt}
                  onError={() => { lab.forgetCreation(); setError('The picture could not be displayed. Please try again.'); }} />
                {busy && <div className="createPictureBusy"><CreatingPicture replacing /></div>}
              </div>
              <p>{picture.prompt}</p>
            </> : busy ? <CreatingPicture /> : <>
            <span className="createSpark" aria-hidden="true">{preview ? '💡' : '✨'}</span>
            <h3>{preview ? 'Your idea is ready!' : 'What will you imagine?'}</h3>
            <p>{preview ? prompt : 'Your drawings + your imagination = a new adventure.'}</p>
            {preview && <span className="createPreviewTag">Idea preview · No image generated yet</span>}
            </>}
          </div>
          {/* Only ever shown for a real generated picture: in demo mode
              `lab.latestCreation` stays null and the panel shows the idea
              preview instead. */}
          {picture && (
            <div className="createDownload">
              <button type="button" className="btn btnPrimary" onClick={() => void download()} disabled={saving}>
                {saving ? '💾 Saving…' : '⬇️ Download my picture'}
              </button>
              {saveError && <p role="alert" className="createMuted">{saveError}</p>}
              <PhoneShare picture={picture} />
            </div>
          )}
          <div className="createLesson">
            <strong>🧠 Recognising and creating are different</strong>
            <p>Your workshop AI compares drawings to recognise them. A separate image-making AI {live ? 'uses' : 'would use'} your examples as clues and your words to create a new picture. It is not trained here on your drawings.</p>
          </div>
          {preview && <div className="createLesson"><strong>🔎 Try an experiment</strong><p>Change one detail in your idea. {live ? 'Compare the results' : 'Once picture generation is connected, compare the results'}: what stayed like your drawings, and what changed?</p></div>}
        </section>
      </div>
    </div>
  );
}
