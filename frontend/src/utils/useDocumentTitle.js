import { useEffect } from 'react';

// Sätter document.title för aktuell route. Vid unmount återställs den till
// "Glosan" så att t.ex. ListDetail inte fastnar i historiken.
//
//   useDocumentTitle('Mina listor');
//   useDocumentTitle(list?.title ? `${list.title} · Glosan` : null);
//
// Skicka null/undefined för att hoppa över (t.ex. medan data laddar).
export function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return undefined;
    const prev = document.title;
    document.title = title.endsWith('Glosan') ? title : `${title} · Glosan`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
