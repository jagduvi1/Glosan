import { useEffect } from 'react';

// Umami räknar sidvisningar — men en delningskod (/p/<kod>) eller en
// ?studyInvite=<kod> i en URL räcker för att gå med i ett barns område, så
// ingen kod får hamna i statistiken: query-strängar tas aldrig med, och koden
// i /p/… byts mot ":code" innan något skickas.
function scrubPayload(type, payload) {
  if (payload && typeof payload.url === 'string') payload.url = payload.url.replace(/^\/p\/[^/?#]+/, '/p/:code');
  if (payload && typeof payload.referrer === 'string') payload.referrer = payload.referrer.replace(/\/p\/[^/?#]+/, '/p/:code');
  return payload;
}

// Injects the Umami tracker once if both env vars are set at build time.
// No-op otherwise — analytics is fully opt-in.
export default function Analytics() {
  useEffect(() => {
    const url = import.meta.env.VITE_UMAMI_URL;
    const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
    if (!url || !websiteId) return;
    if (document.querySelector('script[data-glosan-umami]')) return;

    window.glosanUmamiBeforeSend = scrubPayload;
    const script = document.createElement('script');
    script.src = `${url.replace(/\/$/, '')}/script.js`;
    script.defer = true;
    script.setAttribute('data-website-id', websiteId);
    script.setAttribute('data-exclude-search', 'true');
    script.setAttribute('data-before-send', 'glosanUmamiBeforeSend');
    script.setAttribute('data-glosan-umami', 'true');
    document.head.appendChild(script);
  }, []);
  return null;
}
