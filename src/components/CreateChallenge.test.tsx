import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AiLab } from '../hooks/useAiLab';
import type { GeneratedPicture } from '../types';

/**
 * "Let AI create" is the feature the admin work was built around, so these
 * guard that it still behaves in both demo and live mode.
 *
 * The lab stub below keeps the latest creation the way `useAiLab` does --
 * above the panel, not inside it. That is the point of several of these
 * tests: a child who leaves Let AI create and comes back must still have
 * their picture, so the panel must not be the thing that owns it.
 */
const THUMBNAIL = 'data:image/png;base64,YQ==';
const SHARE_PATH = `/api/shared-image/${'A'.repeat(43)}`;

function baseLab(): AiLab {
  return {
    classes: [{ id: 'cat', name: 'Cat', emoji: '🐱' }],
    counts: { cat: 3 },
    examples: [1, 2, 3].map((index) => ({ id: `e${index}`, classId: 'cat', thumbnail: THUMBNAIL })),
  } as unknown as AiLab;
}

/**
 * The panel inside a holder that owns the latest creation, plus a button that
 * unmounts and remounts it -- which is exactly what switching challenge tab
 * does.
 */
function Harness({ Panel }: { Panel: typeof import('./CreateChallenge')['CreateChallenge'] }) {
  const [latestCreation, setLatestCreation] = useState<GeneratedPicture | null>(null);
  const [open, setOpen] = useState(true);
  const lab = {
    ...baseLab(),
    latestCreation,
    rememberCreation: (picture: Omit<GeneratedPicture, 'createdAt'>) =>
      setLatestCreation({ ...picture, createdAt: 1_700_000_000_000 }),
    forgetCreation: () => setLatestCreation(null),
  } as unknown as AiLab;
  return (
    <>
      <button type="button" onClick={() => setOpen((shown) => !shown)}>
        {open ? 'Go to Memory' : 'Back to Let AI create'}
      </button>
      {open ? <Panel lab={lab} onGoToTeach={() => {}} /> : <p>Memory challenge</p>}
    </>
  );
}

const renderCreate = async () => {
  const { CreateChallenge } = await import('./CreateChallenge');
  return render(<Harness Panel={CreateChallenge} />);
};

/** Picks one option in each of the Look / World / Style groups. */
const chooseEverything = () => {
  for (const label of ['Rainbow', 'On the moon', 'Cartoon']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
  }
};

const live = (endpoint = '/api/generate-image') => {
  vi.stubEnv('VITE_IMAGE_MODE', 'live');
  vi.stubEnv('VITE_IMAGE_ENDPOINT', endpoint);
};

const enterCode = (code = 'FONTYS-A7K2M9PQ') =>
  fireEvent.change(screen.getByLabelText(/Workshop code/), { target: { value: code } });

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('Let AI create', () => {
  it('previews an idea in demo mode without sending anything anywhere', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'demo');
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await renderCreate();

    expect(screen.getByText(/Demo mode/)).toBeInTheDocument();
    // The guided choices are all still there.
    expect(screen.getByText(/Choose its look/)).toBeInTheDocument();
    expect(screen.getByText(/Choose a world/)).toBeInTheDocument();
    expect(screen.getByText(/Choose a style/)).toBeInTheDocument();
    // And the drawing references the child taught.
    expect(screen.getAllByAltText(/Cat example/)).toHaveLength(3);
    // No workshop code is asked for in demo mode.
    expect(screen.queryByLabelText(/Workshop code/)).toBeNull();

    chooseEverything();
    fireEvent.click(screen.getByRole('button', { name: /Preview my idea/ }));
    await screen.findByText(/Idea preview · No image generated yet/);
    expect(fetchMock).not.toHaveBeenCalled();
    // A preview is not a picture, so there is nothing to put on a phone.
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
  });

  it('asks for a workshop code in live mode and sends it as a header, not in the body', async () => {
    live();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ image: THUMBNAIL }) });
    vi.stubGlobal('fetch', fetchMock);
    await renderCreate();

    chooseEverything();
    const create = screen.getByRole('button', { name: /Create my picture/ });
    expect(create).toBeDisabled();

    enterCode();
    expect(create).toBeEnabled();
    fireEvent.click(create);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/generate-image');
    expect(init.headers['X-Workshop-Code']).toBe('FONTYS-A7K2M9PQ');
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      category: { id: 'cat', name: 'Cat' },
      idea: 'rainbow colours, on the Moon, cartoon style',
      style: 'cartoon',
      references: [THUMBNAIL, THUMBNAIL, THUMBNAIL],
    });
    expect(init.body).not.toContain('FONTYS');
    expect(await screen.findByRole('img', { name: /Create a picture of my cat/ })).toBeInTheDocument();
  });

  it('tells the child to wait when the workshop is busy, in words they understand', async () => {
    live();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ code: 'busy' }) }));
    await renderCreate();

    chooseEverything();
    enterCode();
    fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Lots of pictures are being made right now. Wait a moment and try again.');
    expect(alert.textContent).not.toMatch(/queue|concurrency|429|provider|slot/i);
  });

  it('tells the child to ask their teacher when the code is revoked', async () => {
    live();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'revoked' }) }));
    await renderCreate();

    chooseEverything();
    enterCode('FONTYS-OLDCODE1');
    fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That workshop code is not in use any more. Ask your teacher for the new one.');
  });

  /** Creates a real picture in live mode. Resolves once it is on screen. */
  const makeAPicture = async (body: Record<string, unknown> = { image: THUMBNAIL }) => {
    live();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
    const view = await renderCreate();
    chooseEverything();
    enterCode();
    fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));
    await screen.findByRole('img', { name: /Create a picture of my cat/ });
    return view;
  };

  describe('while a picture is being created', () => {
    /** A generation that is still in flight, with its resolver. */
    const startGenerating = async () => {
      live();
      let settle: (value: unknown) => void = () => {};
      const pending = new Promise((resolve) => { settle = resolve; });
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending));
      await renderCreate();
      chooseEverything();
      enterCode();
      fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));
      await screen.findByRole('button', { name: /Creating your picture…/ });
      return { settle };
    };

    it('shows an obvious, honest waiting state with no invented progress', async () => {
      const { settle } = await startGenerating();

      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('Creating your picture…');
      expect(screen.getByText(/this can take a minute/i)).toBeInTheDocument();
      // The result panel says it is working, for anyone not watching the
      // animation.
      expect(document.querySelector('.createPaper')).toHaveAttribute('aria-busy', 'true');
      // No fake percentage and no stage the backend cannot actually see.
      const panel = document.querySelector('.createResult')!;
      expect(panel.textContent).not.toMatch(/\d+\s?%/);
      expect(panel.textContent).not.toMatch(/uploading|rendering|step \d|almost done|adding colour/i);

      settle({ ok: true, status: 200, json: async () => ({ image: THUMBNAIL }) });
      await screen.findByRole('img', { name: /Create a picture of my cat/ });
      expect(document.querySelector('.createPaper')).toHaveAttribute('aria-busy', 'false');
    });

    it('reads the same standing still: the state is text and layout, not the animation', async () => {
      await startGenerating();
      // Nothing about the waiting state is announced by movement alone: the
      // status text, the hint and the decorative pieces are all in the DOM
      // whether or not the browser plays the animation, which is what makes
      // `prefers-reduced-motion` (handled globally in base.css) safe here.
      expect(screen.getByRole('status')).toHaveTextContent(/Creating your picture/);
      expect(document.querySelectorAll('.creatingSparkle')).toHaveLength(3);
      for (const decoration of document.querySelectorAll('.creatingStage, .creatingDots')) {
        expect(decoration).toHaveAttribute('aria-hidden', 'true');
      }
    });

    it('keeps the picture the child already made while a new one is on its way', async () => {
      await makeAPicture();
      const first = screen.getByRole('img', { name: /Create a picture of my cat/ });

      // A second attempt, still in flight.
      let settle: (value: Response) => void = () => {};
      vi.mocked(globalThis.fetch).mockReturnValue(new Promise<Response>((resolve) => { settle = resolve; }));
      fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));
      await screen.findByRole('button', { name: /Creating your picture…/ });

      // The old picture is still there, and it is obvious a new one is coming.
      expect(first).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Creating your picture…');
      expect(screen.getByText(/The one you already made stays here until it arrives/)).toBeInTheDocument();
      // And it can still be saved in the meantime.
      expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();

      settle({ ok: true, status: 200, json: async () => ({ image: 'data:image/png;base64,Yg==' }) } as unknown as Response);
      await waitFor(() => expect(screen.getByRole('img', { name: /Create a picture of my cat/ }))
        .toHaveAttribute('src', 'data:image/png;base64,Yg=='));
    });

    it('keeps the previous picture when the replacement attempt fails', async () => {
      await makeAPicture();
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: false, status: 429, json: async () => ({ code: 'busy' }),
      } as unknown as Response);
      fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Lots of pictures are being made right now.');
      // The failure costs the child a message, not their picture.
      expect(screen.getByRole('img', { name: /Create a picture of my cat/ })).toHaveAttribute('src', THUMBNAIL);
      expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
    });
  });

  describe('the latest creation belongs to the session', () => {
    it('survives leaving Let AI create and coming back', async () => {
      await makeAPicture();
      expect(screen.getByRole('img', { name: /Create a picture of my cat/ })).toBeInTheDocument();

      // Switching challenge tab unmounts this panel entirely.
      fireEvent.click(screen.getByRole('button', { name: 'Go to Memory' }));
      expect(screen.getByText('Memory challenge')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /Create a picture of my cat/ })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Back to Let AI create' }));
      expect(screen.getByRole('img', { name: /Create a picture of my cat/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
    });

    it('keeps the caption that belongs to the picture when choices change underneath it', async () => {
      await makeAPicture();
      const caption = 'Create a picture of my cat: rainbow colours, on the Moon, cartoon style.';
      expect(screen.getByRole('img', { name: caption })).toBeInTheDocument();

      // Trying a different world must neither relabel nor destroy the picture
      // that is already on screen.
      fireEvent.click(screen.getByRole('button', { name: /Ocean blue/i }));
      expect(screen.getByRole('img', { name: caption })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
      // The prompt the next picture would use has changed, though.
      expect(screen.getByText(/ocean blue colours, on the Moon, cartoon style/)).toBeInTheDocument();
    });

    it('lets go of a picture the browser cannot display', async () => {
      await makeAPicture();
      fireEvent.error(screen.getByRole('img', { name: /Create a picture of my cat/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The picture could not be displayed.');
      expect(screen.queryByRole('button', { name: /Download my picture/ })).toBeNull();
    });
  });

  describe('saving it on a phone', () => {
    const shareBody = (expiresInMs = 30 * 60 * 1000) => ({
      image: THUMBNAIL,
      sharePath: SHARE_PATH,
      shareExpiresAt: Date.now() + expiresInMs,
    });

    it('shows a QR code for the picture, on our own API origin', async () => {
      await makeAPicture(shareBody());
      expect(screen.getByRole('heading', { name: /Save it on your phone/ })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
      expect(screen.getByText(/Available for about 30 more minutes/)).toBeInTheDocument();
      // A relative endpoint means the API is this same site.
      const link = screen.getByRole('link', { name: /Open the picture link/ });
      expect(link).toHaveAttribute('href', `${window.location.origin}${SHARE_PATH}`);
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
      // The ordinary download is still the main button.
      expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
    });

    it('derives the absolute URL from an absolute configured endpoint', async () => {
      live('https://api.example.test/api/generate-image');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => shareBody() }));
      await renderCreate();
      chooseEverything();
      enterCode();
      fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));
      await screen.findByRole('img', { name: /Create a picture of my cat/ });
      expect(screen.getByRole('link', { name: /Open the picture link/ }))
        .toHaveAttribute('href', `https://api.example.test${SHARE_PATH}`);
    });

    it('shows no QR code when the server made no share, and still offers the download', async () => {
      await makeAPicture({ image: THUMBNAIL });
      expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
      expect(screen.queryByText(/Save it on your phone/)).toBeNull();
      expect(screen.queryByText(/phone link has expired/)).toBeNull();
      expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
    });

    it('ignores share metadata that is already expired or does not look like ours', async () => {
      for (const body of [
        { image: THUMBNAIL, sharePath: SHARE_PATH, shareExpiresAt: Date.now() - 1 },
        { image: THUMBNAIL, sharePath: 'https://evil.example/steal.png', shareExpiresAt: Date.now() + 60_000 },
        { image: THUMBNAIL, sharePath: '/api/shared-image/short', shareExpiresAt: Date.now() + 60_000 },
        { image: THUMBNAIL, sharePath: SHARE_PATH },
      ]) {
        vi.resetModules();
        const view = await makeAPicture(body);
        expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
        expect(screen.queryByText(/phone link has expired/)).toBeNull();
        expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
        view.unmount();
      }
    });

    it('explains an expired link rather than leaving a dead QR code on screen', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await makeAPicture(shareBody(60_000));
        expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
        await vi.advanceTimersByTimeAsync(70_000);
        await waitFor(() => expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull());
        expect(screen.getByText(/This phone link has expired. Create a new picture to get a new one./))
          .toBeInTheDocument();
        // The picture and its download are untouched by the link expiring.
        expect(screen.getByRole('img', { name: /Create a picture of my cat/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
      } finally { vi.useRealTimers(); }
    });

    it('keeps the QR code after leaving the challenge and coming back', async () => {
      await makeAPicture(shareBody());
      fireEvent.click(screen.getByRole('button', { name: 'Go to Memory' }));
      fireEvent.click(screen.getByRole('button', { name: 'Back to Let AI create' }));
      expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Open the picture link/ }))
        .toHaveAttribute('href', `${window.location.origin}${SHARE_PATH}`);
    });
  });

  describe('the workshop code field', () => {
    it('hides the code by default and reveals it on request, without changing it', async () => {
      live();
      vi.stubGlobal('fetch', vi.fn());
      await renderCreate();

      const field = screen.getByLabelText(/Workshop code/);
      enterCode();
      expect(field).toHaveAttribute('type', 'password');

      const toggle = screen.getByRole('button', { name: 'Show the workshop code' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(toggle);

      expect(field).toHaveAttribute('type', 'text');
      expect(field).toHaveValue('FONTYS-A7K2M9PQ');
      const pressed = screen.getByRole('button', { name: 'Hide the workshop code' });
      expect(pressed).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(pressed);
      expect(field).toHaveAttribute('type', 'password');
      expect(field).toHaveValue('FONTYS-A7K2M9PQ');
      expect(screen.getByRole('button', { name: 'Show the workshop code' })).toBeInTheDocument();
    });

    it('is a real button, so it works from the keyboard and has a big enough target', async () => {
      live();
      vi.stubGlobal('fetch', vi.fn());
      await renderCreate();
      const toggle = screen.getByRole('button', { name: 'Show the workshop code' });
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle).toHaveAttribute('type', 'button');
      expect(toggle).toHaveAttribute('aria-controls', 'workshop-code');
      // Enter and Space activate a button natively; a click is what both
      // produce, and the label flips either way.
      toggle.focus();
      expect(document.activeElement).toBe(toggle);
      fireEvent.click(document.activeElement!);
      expect(screen.getByRole('button', { name: 'Hide the workshop code' })).toBeInTheDocument();
    });
  });

  describe('downloading the picture', () => {
    it('offers a download only once a real picture exists', async () => {
      await makeAPicture();
      const button = screen.getByRole('button', { name: /Download my picture/ });
      expect(button).toBeEnabled();
      // It is a real button, so it stays reachable by keyboard and to a
      // screen reader.
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
    });

    it('is absent in demo mode, where there is only an idea preview', async () => {
      vi.stubEnv('VITE_IMAGE_MODE', 'demo');
      vi.stubEnv('VITE_IMAGE_ENDPOINT', '');
      vi.stubGlobal('fetch', vi.fn());
      await renderCreate();
      expect(screen.queryByRole('button', { name: /Download my picture/ })).toBeNull();
      chooseEverything();
      fireEvent.click(screen.getByRole('button', { name: /Preview my idea/ }));
      await screen.findByText(/Idea preview · No image generated yet/);
      expect(screen.queryByRole('button', { name: /Download my picture/ })).toBeNull();
    });

    it('saves the picture under the name of the category the child chose', async () => {
      const clicks: { href: string; download: string }[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ href: this.getAttribute('href') ?? '', download: this.download });
      });
      try {
        await makeAPicture();
        fireEvent.click(screen.getByRole('button', { name: /Download my picture/ }));
        await waitFor(() => expect(clicks).toHaveLength(1));
        expect(clicks[0]).toEqual({ href: THUMBNAIL, download: 'ai-doodle-cat.png' });
        // The picture is still on screen afterwards, and nothing went wrong.
        expect(screen.getByRole('img', { name: /Create a picture of my cat/ })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
      } finally { click.mockRestore(); }
    });

    it('says something friendly, and keeps the picture, when saving fails', async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('denied'); });
      try {
        await makeAPicture();
        fireEvent.click(screen.getByRole('button', { name: /Download my picture/ }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('The picture could not be saved.');
        expect(alert.textContent).not.toMatch(/denied|blob|anchor|Error/i);
        // Losing the download must not lose the picture.
        expect(screen.getByRole('img', { name: /Create a picture of my cat/ })).toBeInTheDocument();
        // And the child can try again.
        expect(screen.getByRole('button', { name: /Download my picture/ })).toBeEnabled();
      } finally { click.mockRestore(); }
    });

    it('fetches and saves a picture the server returned as an https link', async () => {
      const clicks: string[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this.getAttribute('href') ?? '');
      });
      // jsdom has no object-URL support; only these two statics are replaced,
      // so `new URL(...)` keeps working.
      const urlApi = URL as unknown as { createObjectURL?: (object: Blob) => string; revokeObjectURL?: (url: string) => void };
      const originals = { create: urlApi.createObjectURL, revoke: urlApi.revokeObjectURL };
      const revoked: string[] = [];
      urlApi.createObjectURL = () => 'blob:mock/0';
      urlApi.revokeObjectURL = (url) => { revoked.push(url); };
      try {
        await makeAPicture({ image: 'https://images.example/picture.png' });
        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) } as unknown as Response);
        fireEvent.click(screen.getByRole('button', { name: /Download my picture/ }));
        await waitFor(() => expect(clicks).toEqual(['blob:mock/0']));
        expect(fetchMock).toHaveBeenCalledWith('https://images.example/picture.png');
        expect(revoked).toEqual(['blob:mock/0']);
        expect(screen.queryByRole('alert')).toBeNull();
      } finally {
        click.mockRestore();
        urlApi.createObjectURL = originals.create;
        urlApi.revokeObjectURL = originals.revoke;
      }
    });
  });

  it('asks the child to teach the AI first when nothing has been learned', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'demo');
    const { CreateChallenge } = await import('./CreateChallenge');
    const empty = { classes: [{ id: 'cat', name: 'Cat' }], counts: {}, examples: [] } as unknown as AiLab;
    render(<CreateChallenge lab={empty} onGoToTeach={() => {}} />);
    expect(screen.getByText('Your adventure starts with a drawing')).toBeInTheDocument();
  });
});
