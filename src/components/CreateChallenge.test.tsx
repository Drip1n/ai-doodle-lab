import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AiLab } from '../hooks/useAiLab';

/**
 * "Let AI create" is the feature the admin work was built around, so these
 * guard that it still behaves in both demo and live mode.
 */
const THUMBNAIL = 'data:image/png;base64,YQ==';

function lab(): AiLab {
  return {
    classes: [{ id: 'cat', name: 'Cat', emoji: '🐱' }],
    counts: { cat: 3 },
    examples: [1, 2, 3].map((index) => ({ id: `e${index}`, classId: 'cat', thumbnail: THUMBNAIL })),
  } as unknown as AiLab;
}

const renderCreate = async () => {
  const { CreateChallenge } = await import('./CreateChallenge');
  return render(<CreateChallenge lab={lab()} onGoToTeach={() => {}} />);
};

/** Picks one option in each of the Look / World / Style groups. */
const chooseEverything = () => {
  for (const label of ['Rainbow', 'On the moon', 'Cartoon']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
  }
};

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
  });

  it('asks for a workshop code in live mode and sends it as a header, not in the body', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'live');
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ image: THUMBNAIL }) });
    vi.stubGlobal('fetch', fetchMock);
    await renderCreate();

    chooseEverything();
    const create = screen.getByRole('button', { name: /Create my picture/ });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Workshop code/), { target: { value: 'FONTYS-A7K2M9PQ' } });
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
    vi.stubEnv('VITE_IMAGE_MODE', 'live');
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ code: 'busy' }) }));
    await renderCreate();

    chooseEverything();
    fireEvent.change(screen.getByLabelText(/Workshop code/), { target: { value: 'FONTYS-A7K2M9PQ' } });
    fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Lots of pictures are being made right now. Wait a moment and try again.');
    expect(alert.textContent).not.toMatch(/queue|concurrency|429|provider|slot/i);
  });

  it('tells the child to ask their teacher when the code is revoked', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'live');
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'revoked' }) }));
    await renderCreate();

    chooseEverything();
    fireEvent.change(screen.getByLabelText(/Workshop code/), { target: { value: 'FONTYS-OLDCODE1' } });
    fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That workshop code is not in use any more. Ask your teacher for the new one.');
  });

  it('shows the waiting message while a picture is on its way', async () => {
    vi.stubEnv('VITE_IMAGE_MODE', 'live');
    vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
    let settle: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => { settle = resolve; })));
    await renderCreate();

    chooseEverything();
    fireEvent.change(screen.getByLabelText(/Workshop code/), { target: { value: 'FONTYS-A7K2M9PQ' } });
    fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));

    await screen.findByRole('button', { name: /Making your picture…/ });
    expect(screen.getByText(/Making your picture… Lots of pictures may be on their way/)).toBeInTheDocument();
    settle({ ok: true, status: 200, json: async () => ({ image: THUMBNAIL }) });
    await screen.findByRole('img', { name: /Create a picture of my cat/ });
  });

  describe('downloading the picture', () => {
    /** Creates a real picture in live mode and returns the anchor spy. */
    const makeAPicture = async (image = THUMBNAIL) => {
      vi.stubEnv('VITE_IMAGE_MODE', 'live');
      vi.stubEnv('VITE_IMAGE_ENDPOINT', '/api/generate-image');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ image }) }));
      await renderCreate();
      chooseEverything();
      fireEvent.change(screen.getByLabelText(/Workshop code/), { target: { value: 'FONTYS-A7K2M9PQ' } });
      fireEvent.click(screen.getByRole('button', { name: /Create my picture/ }));
      await screen.findByRole('img', { name: /Create a picture of my cat/ });
    };

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
        await makeAPicture('https://images.example/picture.png');
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

    it('disappears again when the child changes an answer and starts over', async () => {
      await makeAPicture();
      expect(screen.getByRole('button', { name: /Download my picture/ })).toBeInTheDocument();
      // Changing a choice clears the result, so there is nothing to save.
      fireEvent.click(screen.getByRole('button', { name: /Ocean blue/i }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /Download my picture/ })).toBeNull());
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
