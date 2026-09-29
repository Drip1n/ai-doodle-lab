/**
 * Playwright-only harness. It mounts a bare DrawingCanvas so the pointer
 * lifecycle can be exercised with real browser touch input without waiting
 * for MobileNet to download. It is never part of `npm run build`, whose only
 * entry is the app's own index.html.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DrawingCanvas } from '../../src/components/DrawingCanvas';
import '../../src/styles/base.css';
import '../../src/styles/app.css';

function Harness() {
  const [dirty, setDirty] = useState(false);
  return (
    <main style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
      <DrawingCanvas onDirtyChange={setDirty} />
      <p data-testid="dirty">{dirty ? 'dirty' : 'clean'}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
