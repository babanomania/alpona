import type { Page } from '@playwright/test';

/**
 * Cinematic overlay for the demo recording: a smoothly-animated fake cursor,
 * click ripples, and caption lower-thirds. Headless Chromium never paints the
 * OS pointer into the video, so we render our own in the DOM. Everything is
 * fixed-position and injected via addInitScript, so it survives the studio's
 * client-side renders.
 */

declare global {
  interface Window {
    __demo: {
      moveTo(x: number, y: number, ms: number): Promise<void>;
      ripple(x: number, y: number): void;
      caption(text: string): void;
      clearCaption(): void;
    };
  }
}

const OVERLAY_SCRIPT = `
(() => {
  if (window.__demo) return;
  const style = document.createElement('style');
  style.textContent = \`
    #demo-cursor {
      position: fixed; top: 0; left: 0; width: 22px; height: 22px;
      margin: -2px 0 0 -2px; z-index: 2147483647; pointer-events: none;
      transition: transform .08s ease-out;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,.5));
    }
    .demo-ripple {
      position: fixed; z-index: 2147483646; pointer-events: none;
      width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 2px solid #e8a44a; opacity: .9;
      animation: demo-ripple-anim .55s ease-out forwards;
    }
    @keyframes demo-ripple-anim {
      to { transform: scale(3.4); opacity: 0; }
    }
    #demo-caption {
      position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%) translateY(12px);
      z-index: 2147483645; pointer-events: none; opacity: 0;
      max-width: 70%; text-align: center;
      padding: 13px 24px; border-radius: 14px;
      background: rgba(19,14,18,.62); border: 1px solid rgba(255,255,255,.08);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      color: #f2e4c9; font-family: 'Outfit', system-ui, sans-serif;
      font-size: 19px; line-height: 1.4; letter-spacing: .005em;
      transition: opacity .35s ease, transform .35s ease;
    }
    #demo-caption.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  \`;
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><path d="M3 2l6.5 16 2.4-6.6L18 9.2 3 2z" fill="#f2e4c9" stroke="#1a1016" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  const attach = () => {
    document.body.appendChild(style);
    document.body.appendChild(cursor);
    document.body.appendChild(caption);
  };
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);

  let cx = 640, cy = 360;
  const place = () => { cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px)'; };
  place();

  window.__demo = {
    moveTo(x, y, ms) {
      return new Promise((done) => {
        const sx = cx, sy = cy, t0 = performance.now();
        const ease = (p) => (p < .5 ? 2*p*p : 1 - Math.pow(-2*p+2,2)/2);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / Math.max(1, ms));
          const e = ease(p);
          cx = sx + (x - sx) * e; cy = sy + (y - sy) * e; place();
          if (p < 1) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
    },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'demo-ripple';
      r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    },
    caption(text) {
      caption.textContent = text;
      caption.classList.add('show');
    },
    clearCaption() {
      caption.classList.remove('show');
    },
  };
})();
`;

/** Inject the overlay so it is present on first paint and every render. */
export async function installOverlay(page: Page): Promise<void> {
  await page.addInitScript(OVERLAY_SCRIPT);
}

/** Move the fake cursor to the centre of a located element. */
export async function cursorTo(page: Page, selector: string, ms = 650): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`cursorTo: no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([px, py, pms]) => window.__demo.moveTo(px, py, pms), [x, y, ms] as const);
}

/** Animate the cursor to an element, ripple, then perform a real click. */
export async function demoClick(page: Page, selector: string): Promise<void> {
  await cursorTo(page, selector);
  const box = await page.locator(selector).first().boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(([px, py]) => window.__demo.ripple(px, py), [x, y] as const);
  }
  await page.locator(selector).first().click();
}

/** Show a caption lower-third; pass null to clear it. */
export async function caption(page: Page, text: string | null): Promise<void> {
  if (text === null) await page.evaluate(() => window.__demo.clearCaption());
  else await page.evaluate((t) => window.__demo.caption(t), text);
}
