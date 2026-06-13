import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Procedural alpona: the traditional Bengali floor pattern, traced in
 * light. Points are laid along concentric motif rings (lotus, dotted
 * circles, petals, an outer kolam ring) and revealed in drawing order via
 * setDrawRange — the pattern draws itself on mount, then slowly turns.
 *
 * Deliberately dependency-light: plain three.js, no fiber. Falls back to
 * nothing (the CSS gradient behind it carries the hero) when WebGL is
 * unavailable, renders a single static frame under reduced motion, and
 * pauses while the tab is hidden.
 */

interface Palette {
  base: THREE.Color;
  accent: THREE.Color;
  glow: THREE.Color;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    base: new THREE.Color('#b4452f'), // terracotta — rice paste's inverse on a light page
    accent: new THREE.Color('#8a2f4f'),
    glow: new THREE.Color('#d98e3b'),
  },
  dark: {
    base: new THREE.Color('#f2e4c9'), // ivory rice paste on the night floor
    accent: new THREE.Color('#e8a44a'),
    glow: new THREE.Color('#c96a4a'),
  },
};

interface RingPoint {
  x: number;
  y: number;
  ring: number;
}

function buildPattern(): RingPoint[] {
  const pts: RingPoint[] = [];
  const ring = (
    index: number,
    samples: number,
    radius: (theta: number) => number,
    keep: (theta: number) => boolean = () => true,
  ) => {
    for (let i = 0; i < samples; i++) {
      const theta = (i / samples) * Math.PI * 2;
      if (!keep(theta)) continue;
      const r = radius(theta);
      pts.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, ring: index });
    }
  };

  // Center lotus: eight petals.
  ring(0, 1400, (t) => 0.3 + 0.17 * Math.abs(Math.cos(t * 4)));
  // Inner dotted circle: 36 beads with gaps.
  ring(
    1,
    720,
    () => 0.56,
    (t) => (t * 36) % (Math.PI * 2) < Math.PI * 0.9,
  );
  // Vine band: gentle 12-lobe wave.
  ring(2, 1500, (t) => 0.68 + 0.045 * Math.sin(t * 12));
  // Outer petals: six sharp lobes.
  ring(3, 1800, (t) => 0.82 + 0.13 * Math.pow(Math.abs(Math.cos(t * 3 + Math.PI / 6)), 3));
  // Outermost dashed circle.
  ring(
    4,
    900,
    () => 1.0,
    (t) => (t * 18) % (Math.PI * 2) < Math.PI * 1.1,
  );
  return pts;
}

export function AlponaHero({ dark }: { dark: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<'light' | 'dark'>(dark ? 'dark' : 'light');
  const applyPaletteRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return; // no WebGL — the CSS gradient carries the hero alone
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.1, 10);
    camera.position.z = 2;

    const pattern = buildPattern();
    const positions = new Float32Array(pattern.length * 3);
    const colors = new Float32Array(pattern.length * 3);
    pattern.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = 0;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
      size: 0.018,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const applyPalette = () => {
      const palette = PALETTES[paletteRef.current];
      const mixed = new THREE.Color();
      pattern.forEach((p, i) => {
        const source =
          p.ring === 0 ? palette.accent : p.ring % 2 === 0 ? palette.base : palette.glow;
        mixed.copy(source);
        colors[i * 3] = mixed.r;
        colors[i * 3 + 1] = mixed.g;
        colors[i * 3 + 2] = mixed.b;
      });
      geometry.attributes.color!.needsUpdate = true;
      material.blending =
        paletteRef.current === 'dark' ? THREE.AdditiveBlending : THREE.NormalBlending;
      material.needsUpdate = true;
    };
    applyPalette();
    applyPaletteRef.current = applyPalette;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const resize = () => {
      const size = Math.min(mount.clientWidth, mount.clientHeight);
      renderer.setSize(size, size);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      geometry.setDrawRange(0, pattern.length);
      renderer.render(scene, camera);
    }

    let frame = 0;
    let start: number | null = null;
    let hidden = document.hidden;
    const DRAW_MS = 4200;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (hidden) return;
      if (start === null) start = now;
      const elapsed = now - start;
      // Draw-on: ease the revealed point count, ring after ring.
      const t = Math.min(elapsed / DRAW_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      geometry.setDrawRange(0, Math.floor(eased * pattern.length));
      // Then keep turning, slowly, the way the artist circles the motif.
      points.rotation.z = elapsed * 0.000045;
      const breathe = 1 + Math.sin(elapsed * 0.0006) * 0.012;
      points.scale.setScalar(breathe);
      renderer.render(scene, camera);
    };
    if (!reducedMotion) frame = requestAnimationFrame(tick);

    const onVisibility = () => {
      hidden = document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      applyPaletteRef.current = null;
    };
  }, []);

  // Theme flips repaint vertex colors in place — no scene rebuild.
  useEffect(() => {
    paletteRef.current = dark ? 'dark' : 'light';
    applyPaletteRef.current?.();
  }, [dark]);

  return <div ref={mountRef} className="alpona-hero-canvas" aria-hidden />;
}
