import { useEffect, useRef, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import type { ClassId } from '../types';
import { loadImageFile } from '../ml/imageProcessing';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { ClassCard } from './ClassCard';
import { AddClassCard } from './AddClassCard';
import { DatasetSummary } from './DatasetSummary';
import { MemoryWall } from './MemoryWall';
import { Coach } from './Coach';
import { ConfirmDialog } from './ConfirmDialog';

type TeachState = 'idle' | 'teaching' | 'done';

export interface FocusRequest {
  classId: ClassId;
  token: number;
}

export function TeachStage({ lab, focusRequest }: { lab: AiLab; focusRequest?: FocusRequest | null }) {
  const [selected, setSelected] = useState<ClassId | null>(null);
  const [dirty, setDirty] = useState(false);
  const [uploaded, setUploaded] = useState<HTMLImageElement | null>(null);
  const [teachState, setTeachState] = useState<TeachState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClassId | null>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  // Keep the selection valid as classes are created, renamed away from, or deleted.
  useEffect(() => {
    if (lab.classes.length === 0) return;
    if (!selected || !lab.classes.some((def) => def.id === selected)) {
      setSelected(lab.classes[0].id);
    }
  }, [lab.classes, selected]);

  // A request from the Learn page to jump straight into teaching one category.
  useEffect(() => {
    if (focusRequest && lab.classes.some((def) => def.id === focusRequest.classId)) {
      setSelected(focusRequest.classId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.token]);

  const activeClass = lab.classes.find((def) => def.id === selected) ?? lab.classes[0] ?? null;
  const modelReady = lab.modelStatus.state === 'ready';
  const hasSomething = uploaded !== null || dirty;
  const canTeach = modelReady && hasSomething && teachState === 'idle' && activeClass !== null;
  const deleteTargetDef = lab.classes.find((def) => def.id === deleteTarget) ?? null;

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const image = await loadImageFile(file);
      setUploaded(image);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'That image did not work.');
    }
  };

  const handleTeach = async () => {
    const source = uploaded ?? canvasRef.current?.getCanvas();
    if (!source || !activeClass) return;
    setError(null);
    setTeachState('teaching');
    try {
      await lab.teach(source, activeClass.id, uploaded ? 'upload' : 'drawing');
      setTeachState('done');
      timerRef.current = window.setTimeout(() => {
        setTeachState('idle');
        canvasRef.current?.clear();
        setUploaded(null);
        setDirty(false);
      }, 1100);
    } catch (teachError) {
      setTeachState('idle');
      setError(teachError instanceof Error ? teachError.message : 'Something went wrong.');
    }
  };

  if (!activeClass) {
    return (
      <div className="stage">
        <header className="stageHead">
          <h2 className="stageTitle">Teach your AI</h2>
          <p className="stageSub">Getting your categories ready…</p>
        </header>
      </div>
    );
  }

  return (
    <div className="stage">
      <header className="stageHead">
        <h2 className="stageTitle">Teach your AI</h2>
        <p className="stageSub">
          Give the AI examples so it can learn what each thing looks like.
        </p>
      </header>

      <div className="classRow">
        {lab.classes.map((def) => (
          <ClassCard
            key={def.id}
            def={def}
            count={lab.counts[def.id] ?? 0}
            selected={def.id === selected}
            canDelete={lab.canDeleteClass}
            onSelect={() => setSelected(def.id)}
            onRename={(name) => lab.renameClass(def.id, name)}
            onChangeEmoji={(emoji) => lab.changeEmoji(def.id, emoji)}
            onRequestDelete={() => setDeleteTarget(def.id)}
          />
        ))}
        {lab.canAddClass && <AddClassCard onAdd={(name, emoji) => lab.addClass(name, emoji)} />}
      </div>

      <div className="workGrid">
        <section className="panel workspace" style={{ borderColor: activeClass.accent }}>
          <p className="workspaceBadge" style={{ background: activeClass.accentSoft, color: activeClass.accent }}>
            <span aria-hidden="true">{activeClass.emoji}</span> Teaching: {activeClass.name}
          </p>

          {uploaded ? (
            <div className="uploadPreviewWrap">
              <img src={uploaded.src} alt="Uploaded example" className="uploadPreview" />
              <button type="button" className="btn btnGhost" onClick={() => setUploaded(null)}>
                ← Back to drawing
              </button>
            </div>
          ) : (
            <DrawingCanvas
              ref={canvasRef}
              accent={activeClass.accent}
              onDirtyChange={setDirty}
              disabled={!modelReady}
            />
          )}

          <div className="workspaceActions">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visuallyHidden"
              onChange={handleUpload}
            />
            <button
              type="button"
              className="btn btnGhost"
              onClick={() => fileRef.current?.click()}
              disabled={!modelReady}
            >
              🖼️ Upload image
            </button>
            <button
              type="button"
              className="btn btnPrimary btnBig"
              style={{ background: activeClass.accent }}
              onClick={handleTeach}
              disabled={!canTeach}
            >
              {teachState === 'teaching' && 'Teaching AI…'}
              {teachState === 'done' && 'Learned! 🧠'}
              {teachState === 'idle' && `Teach AI this ${activeClass.name}`}
            </button>
          </div>

          {teachState !== 'idle' && (
            <div className={`teachFlash ${teachState}`} role="status">
              {teachState === 'teaching' ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Teaching AI…
                </>
              ) : (
                <>
                  🧠 Learned! Your AI now has {lab.counts[activeClass.id] ?? 0} {activeClass.name}{' '}
                  examples.
                </>
              )}
            </div>
          )}

          {!hasSomething && teachState === 'idle' && (
            <p className="hintLine">Draw something (or upload a picture) to teach the AI.</p>
          )}
          {error && <p className="errorLine">⚠️ {error}</p>}
        </section>

        <div className="sideColumn">
          <Coach classes={lab.classes} counts={lab.counts} total={lab.total} />
          <DatasetSummary classes={lab.classes} counts={lab.counts} total={lab.total} />
          <MemoryWall classes={lab.classes} counts={lab.counts} examples={lab.examples} />
        </div>
      </div>

      {deleteTargetDef && (
        <ConfirmDialog
          title={`Delete ${deleteTargetDef.name}?`}
          message="This will also forget all examples for this category."
          confirmLabel="Yes, delete it"
          onConfirm={() => {
            void lab.deleteClass(deleteTargetDef.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
