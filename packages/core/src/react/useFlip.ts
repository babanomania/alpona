import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * FLIP animation across re-layouts: when a patch moves widgets, each card
 * slides from its previous screen position to its new one instead of
 * snapping. First/Last/Invert/Play with the WAAPI.
 */
export function useFlip(dependency: unknown) {
  const elements = useRef(new Map<string, HTMLElement>());
  const previousRects = useRef(new Map<string, DOMRect>());

  const register = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) elements.current.set(id, el);
      else elements.current.delete(id);
    },
    [],
  );

  useLayoutEffect(() => {
    const prev = previousRects.current;
    const next = new Map<string, DOMRect>();

    for (const [id, el] of elements.current) {
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      const before = prev.get(id);
      if (!before) continue;

      const dx = before.left - rect.left;
      const dy = before.top - rect.top;
      const sx = rect.width > 0 ? before.width / rect.width : 1;
      const sy = rect.height > 0 ? before.height / rect.height : 1;
      if (
        Math.abs(dx) < 1 &&
        Math.abs(dy) < 1 &&
        Math.abs(sx - 1) < 0.01 &&
        Math.abs(sy - 1) < 0.01
      )
        continue;

      el.animate(
        [
          {
            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
            transformOrigin: 'top left',
          },
          { transform: 'none', transformOrigin: 'top left' },
        ],
        { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }

    previousRects.current = next;
  }, [dependency]);

  return register;
}
