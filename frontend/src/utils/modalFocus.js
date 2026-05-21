import { useEffect, useRef } from 'react';

// Trapps Tab/Shift+Tab inom ett modal-element och flyttar fokus dit vid mount.
// Returnerar en ref som ska sättas på modal-noden.
//
//   const ref = useModalFocus(onClose)
//   <div ref={ref} className="modal"> ... </div>
//
// Escape stänger via onClose. Vid unmount återställs fokus till elementet
// som hade det innan modalen öppnades.
export function useModalFocus(onClose) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const prevFocus = document.activeElement;

    const focusable = () => Array.from(
      node.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('aria-hidden'));

    const focusFirst = () => {
      const items = focusable();
      if (items.length > 0) items[0].focus();
      else node.focus();
    };

    // Mikrofördröjning så React-render hinner klart innan vi flyttar fokus.
    const t = setTimeout(focusFirst, 0);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (onClose) onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      node.removeEventListener('keydown', onKey);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch { /* ignore */ }
      }
    };
  }, [onClose]);

  return ref;
}
