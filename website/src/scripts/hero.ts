import * as THREE from 'three';

/**
 * The website hero (decision D12): a particle cloud that draws the alpona
 * pattern, then morphs — the same points, rearranged — into a dashboard
 * wireframe as you scroll through the sticky scene. Ported from
 * design/mockups/alpona-website-landing.html.
 */
export function initHero(): void {
  const sceneEl = document.getElementById('scene');
  if (!sceneEl) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── point targets ───────────────────────────────────────────────
  function alponaPoints() {
    const pts: number[] = [];
    const grp: number[] = [];
    const ring = (g: number, n: number, rFn: (t: number) => number, keep?: (t: number) => boolean) => {
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        if (keep && !keep(t)) continue;
        const r = rFn(t);
        pts.push(Math.cos(t) * r, Math.sin(t) * r, 0);
        grp.push(g);
      }
    };
    ring(0, 1500, (t) => 0.3 + 0.165 * Math.pow(Math.abs(Math.cos(t * 4)), 0.65));
    ring(1, 460, () => 0.52, (t) => ((t / (Math.PI * 2)) * 36) % 1 < 0.55);
    ring(2, 1300, (t) => 0.665 + 0.05 * Math.sin(t * 12));
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2 + Math.PI / 8;
      for (let i = 0; i < 70; i++) {
        const f = i / 70;
        const r = 0.34 + f * 0.155;
        const w = Math.sin(f * Math.PI) * 0.035;
        pts.push(Math.cos(a) * r - Math.sin(a) * w, Math.sin(a) * r + Math.cos(a) * w, 0);
        grp.push(3);
      }
    }
    ring(4, 620, () => 0.795, (t) => ((t / (Math.PI * 2)) * 48) % 1 < 0.5);
    ring(5, 1700, (t) => 0.915 + 0.045 * Math.sin(t * 16));
    ring(6, 260, () => 1.02, (t) => ((t / (Math.PI * 2)) * 24) % 1 < 0.32);
    return { pts, grp };
  }

  function dashboardPoints() {
    const segs: number[][] = [];
    const rect = (x: number, y: number, w: number, h: number, g: number) => {
      segs.push([x, y, x + w, y, g], [x + w, y, x + w, y + h, g], [x + w, y + h, x, y + h, g], [x, y + h, x, y, g]);
    };
    const W = 2.4;
    const H = 1.7;
    const L = -W / 2;
    const B = -H / 2;
    const kw = (W - 0.18 * 3) / 4;
    for (let i = 0; i < 4; i++) rect(L + i * (kw + 0.18), B + H - 0.34, kw, 0.34, 0);
    rect(L, B + 0.5, W * 0.62, 0.74, 1);
    const cx0 = L + 0.07;
    const cw = W * 0.62 - 0.14;
    const cy = B + 0.58;
    const curve = (amp: number, off: number, g: number) => {
      const prev: number[] = [];
      for (let i = 0; i <= 90; i++) {
        const f = i / 90;
        const y = cy + off + amp * (0.5 + 0.5 * Math.sin(f * 5.2 - 1.4)) * Math.pow(f, 0.7) + 0.05 * Math.sin(f * 14);
        const x = cx0 + f * cw;
        if (prev.length) segs.push([prev[0]!, prev[1]!, x, y, g]);
        prev[0] = x;
        prev[1] = y;
      }
    };
    curve(0.42, 0.05, 2);
    curve(0.22, 0.02, 3);
    rect(L + W * 0.62 + 0.18, B + 0.5, W - W * 0.62 - 0.18, 0.74, 1);
    const sx = L + W * 0.62 + 0.26;
    [0.78, 0.58, 0.4, 0.26].forEach((f, i) => {
      const y = B + 0.62 + i * 0.15;
      segs.push([sx, y, sx + f * (W - W * 0.62 - 0.34), y, 4]);
    });
    rect(L, B, W, 0.36, 1);
    for (let i = 1; i <= 2; i++) {
      const y = B + i * 0.12;
      segs.push([L + 0.06, y, L + W - 0.06, y, 5]);
    }
    let total = 0;
    const lens = segs.map((s) => {
      const l = Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!);
      total += l;
      return l;
    });
    const pts: number[] = [];
    const grp: number[] = [];
    const N = 6100;
    segs.forEach((s, i) => {
      const n = Math.max(2, Math.round((lens[i]! / total) * N));
      for (let j = 0; j < n; j++) {
        const f = j / n;
        pts.push(s[0]! + (s[2]! - s[0]!) * f, s[1]! + (s[3]! - s[1]!) * f, 0);
        grp.push(s[4]!);
      }
    });
    return { pts, grp };
  }

  const A = alponaPoints();
  const D = dashboardPoints();
  const count = (Math.max(A.pts.length / 3, D.pts.length / 3) | 0) as number;
  const pad = (o: { pts: number[]; grp: number[] }, n: number) => {
    const p = o.pts.slice();
    const g = o.grp.slice();
    while (p.length / 3 < n) {
      const k = (Math.random() * o.grp.length) | 0;
      p.push(o.pts[k * 3]!, o.pts[k * 3 + 1]!, 0);
      g.push(o.grp[k]!);
    }
    return { pts: new Float32Array(p), grp: g };
  };
  const PA = pad(A, count);
  const PD = pad(D, count);

  const ivory = [0.95, 0.89, 0.79];
  const mar = [0.91, 0.64, 0.29];
  const ter = [0.79, 0.42, 0.29];
  const plum = [0.62, 0.26, 0.4];
  const dim = [0.55, 0.48, 0.42];
  const colA = new Float32Array(count * 3);
  const colB = new Float32Array(count * 3);
  const setC = (arr: Float32Array, i: number, c: number[]) => {
    arr[i * 3] = c[0]!;
    arr[i * 3 + 1] = c[1]!;
    arr[i * 3 + 2] = c[2]!;
  };
  for (let i = 0; i < count; i++) {
    const ga = PA.grp[i];
    setC(colA, i, ga === 0 ? ter : ga === 1 || ga === 4 || ga === 6 ? mar : ga === 3 ? plum : ivory);
    const gd = PD.grp[i];
    setC(colB, i, gd === 2 ? mar : gd === 3 ? plum : gd === 4 ? ter : gd === 0 ? ivory : gd === 5 ? dim : ivory);
  }
  const order = new Float32Array(count);
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = PA.pts[i * 3]!;
    const y = PA.pts[i * 3 + 1]!;
    const r = Math.hypot(x, y);
    order[i] = Math.min(1, (r / 1.05) * 0.85 + ((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 0.15);
    rnd[i] = Math.random();
  }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return; // no WebGL — the static copy still tells the story
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  sceneEl.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  cam.position.set(0, 0, 3.4);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(PA.pts, 3));
  geo.setAttribute('aTarget', new THREE.BufferAttribute(PD.pts, 3));
  geo.setAttribute('aColA', new THREE.BufferAttribute(colA, 3));
  geo.setAttribute('aColB', new THREE.BufferAttribute(colB, 3));
  geo.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));

  const uni = {
    uMorph: { value: 0 },
    uReveal: { value: 0 },
    uTime: { value: 0 },
    uSize: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aTarget; attribute vec3 aColA; attribute vec3 aColB;
      attribute float aOrder; attribute float aRnd;
      uniform float uMorph,uReveal,uTime,uSize;
      varying vec3 vCol; varying float vA;
      void main(){
        float t=clamp((uMorph*1.35 - aRnd*0.35),0.,1.);
        t=t*t*(3.-2.*t);
        vec3 p=mix(position,aTarget,t);
        float lift=sin(t*3.14159);
        p.z += lift*(0.18+aRnd*0.30);
        float sw=lift*0.55*(aRnd-0.5);
        p.xy=mat2(cos(sw),-sin(sw),sin(sw),cos(sw))*p.xy;
        p.xy += (1.-t)*0.006*vec2(sin(uTime*0.7+aRnd*40.),cos(uTime*0.6+aRnd*30.));
        vCol=mix(aColA,aColB,t);
        vA=smoothstep(aOrder,aOrder+0.05,uReveal);
        vec4 mv=modelViewMatrix*vec4(p,1.);
        gl_Position=projectionMatrix*mv;
        gl_PointSize=(2.0+aRnd*1.6+lift*2.2)*uSize*(3.4/-mv.z);
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vA;
      void main(){
        vec2 c=gl_PointCoord-0.5;
        float d=length(c);
        float a=smoothstep(0.5,0.12,d)*vA;
        if(a<0.01)discard;
        gl_FragColor=vec4(vCol,a*0.92);
      }`,
  });
  const cloud = new THREE.Points(geo, mat);
  scene.add(cloud);

  function resize() {
    const w = sceneEl!.clientWidth;
    const h = sceneEl!.clientHeight;
    renderer.setSize(w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    uni.uSize.value = Math.min(1.25, w / 900 + 0.55);
    const fit = Math.min(w / h, 1.45);
    cloud.scale.setScalar(0.62 + 0.28 * fit);
  }
  addEventListener('resize', resize);
  resize();

  let tmx = 0;
  let tmy = 0;
  let mx = 0;
  let my = 0;
  addEventListener(
    'pointermove',
    (e) => {
      tmx = e.clientX / innerWidth - 0.5;
      tmy = e.clientY / innerHeight - 0.5;
    },
    { passive: true },
  );

  const wrap = document.getElementById('scene-wrap')!;
  const beats = [
    document.getElementById('beat-hero'),
    document.getElementById('beat-1'),
    document.getElementById('beat-2'),
    document.getElementById('beat-3'),
  ];
  const cue = document.getElementById('cue');
  let morphTarget = 0;
  let morph = 0;

  function progress() {
    const r = wrap.getBoundingClientRect();
    const total = r.height - innerHeight;
    return Math.min(1, Math.max(0, -r.top / total));
  }
  function choreograph(p: number) {
    const win = [
      [0, 0.16],
      [0.2, 0.42],
      [0.46, 0.7],
      [0.76, 1.01],
    ];
    beats.forEach((b, i) => b?.classList.toggle('show', p >= win[i]![0]! && p < win[i]![1]!));
    if (cue) cue.style.opacity = p < 0.04 ? '1' : '0';
    morphTarget = p < 0.34 ? 0 : p > 0.66 ? 1 : (p - 0.34) / 0.32;
    cam.position.z = 3.4 - p * 0.5;
  }

  const clock = new THREE.Clock();
  let revealStart: number | null = null;
  function tick() {
    requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    uni.uTime.value = t;
    if (revealStart === null) revealStart = t;
    uni.uReveal.value = reduced ? 1 : Math.min(1, (t - revealStart) / 3.6);
    choreograph(progress());
    morph += (morphTarget - morph) * (reduced ? 1 : 0.07);
    uni.uMorph.value = morph;
    mx += (tmx - mx) * 0.05;
    my += (tmy - my) * 0.05;
    cloud.rotation.z = reduced ? 0 : (1 - morph) * t * 0.05 + mx * 0.12;
    cloud.rotation.x = -my * 0.18 * (1 - morph * 0.6);
    cloud.rotation.y = mx * 0.22;
    renderer.render(scene, cam);
  }
  tick();

  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.18 },
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
