import { useEffect } from 'react';

// Injects the Umami tracker once if both env vars are set at build time.
// No-op otherwise — analytics is fully opt-in.
export default function Analytics() {
  useEffect(() => {
    const url = process.env.REACT_APP_UMAMI_URL;
    const websiteId = process.env.REACT_APP_UMAMI_WEBSITE_ID;
    if (!url || !websiteId) return;
    if (document.querySelector('script[data-glosan-umami]')) return;

    const script = document.createElement('script');
    script.src = `${url.replace(/\/$/, '')}/script.js`;
    script.defer = true;
    script.setAttribute('data-website-id', websiteId);
    script.setAttribute('data-glosan-umami', 'true');
    document.head.appendChild(script);
  }, []);
  return null;
}
