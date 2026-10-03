import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { GeneratedPicture } from '../types';
import { shareUrl } from '../generative/imageApi';
import { hasLiveShare } from '../generative/latestCreation';

/**
 * "Scan to save on your phone".
 *
 * At a booth the machine making the picture is not the child's, so
 * "Download my picture" saves it somewhere they will never see again. The QR
 * code is the handoff: it points at a temporary copy our own API is holding
 * in memory behind a random token, which expires on its own.
 *
 * The code is drawn here in the browser. No QR web service is involved, so
 * nothing about a child's picture is handed to a third party to make it.
 */

/** How often the panel re-checks the clock, so expiry shows up on its own. */
const TICK_MS = 20_000;

const minutesLeft = (expiresAt: number, now: number) =>
  Math.max(1, Math.round((expiresAt - now) / 60_000));

export function PhoneShare({ picture }: { picture: GeneratedPicture }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // No share at all: the server either could not make one or has sharing
  // switched off. The ordinary download is still there, and saying nothing is
  // better than explaining a feature the child never saw.
  const expiresAt = picture.shareExpiresAt;
  if (!picture.sharePath || expiresAt === undefined) return null;

  if (!hasLiveShare(picture, now)) {
    return (
      <p className="phoneShareExpired" role="status">
        ⌛ This phone link has expired. Create a new picture to get a new one.
      </p>
    );
  }

  const url = shareUrl(picture.sharePath);
  if (!url) return null;

  return (
    <section className="phoneShare" aria-labelledby="phone-share-title">
      <h4 id="phone-share-title">📱 Save it on your phone</h4>
      <p className="createMuted">Scan this QR code with your phone's camera.</p>
      <div className="phoneShareCode">
        <QRCodeSVG
          value={url}
          size={168}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#241d17"
          role="img"
          aria-label="QR code that opens your picture on a phone"
          title="QR code that opens your picture on a phone"
        />
      </div>
      <p className="createMuted">
        Available for about {minutesLeft(expiresAt, now)} more minutes, then the link stops working.
      </p>
      <a className="btn btnGhost phoneShareLink" href={url} target="_blank" rel="noopener noreferrer">
        🔗 Open the picture link
      </a>
    </section>
  );
}
