import { useEffect, useState } from 'react';
import { Sparkles, Wand2, RefreshCw } from 'lucide-react';

/**
 * The hero "video": a self-playing, looping simulation of a dashboard
 * being generated and refined in real time. Scripted entirely in
 * CSS/React (no video file): a prompt types itself, a skeleton appears,
 * widgets bind one by one, then a refinement morphs the chart live.
 */

const PROMPT = 'Late shipments by carrier, and flag suppliers averaging 3+ days late…';
const REFINE = 'top 5 only, as weekly trend';

const FULL_BARS = [78, 52, 41, 33, 26, 18, 12];
const REFINED_BARS = [82, 61, 44, 30, 22];

type Phase = 'typing' | 'skeleton' | 'binding' | 'live' | 'refine-typing' | 'refined';

const TIMELINE: { phase: Phase; ms: number }[] = [
  { phase: 'typing', ms: 2600 },
  { phase: 'skeleton', ms: 900 },
  { phase: 'binding', ms: 1700 },
  { phase: 'live', ms: 2400 },
  { phase: 'refine-typing', ms: 1800 },
  { phase: 'refined', ms: 3200 },
];

export function DemoPlayer() {
  const [phase, setPhase] = useState<Phase>('typing');
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      step = (step + 1) % TIMELINE.length;
      setPhase(TIMELINE[step]!.phase);
      timer = setTimeout(advance, TIMELINE[step]!.ms);
    };
    timer = setTimeout(advance, TIMELINE[0]!.ms);
    return () => clearTimeout(timer);
  }, []);

  // Typewriter for whichever prompt the current phase shows.
  const text = phase === 'refine-typing' ? REFINE : PROMPT;
  const isTyping = phase === 'typing' || phase === 'refine-typing';
  useEffect(() => {
    if (!isTyping) return;
    const speed = phase === 'typing' ? 32 : 55;
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setTyped(n);
      if (n < text.length) {
        n += 1;
        timer = setTimeout(tick, speed);
      }
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [phase, isTyping, text.length]);

  const bars = phase === 'refined' ? REFINED_BARS : FULL_BARS;
  const bound = phase === 'live' || phase === 'refined' || phase === 'refine-typing';
  const skeleton = phase === 'skeleton' || phase === 'binding';

  return (
    <div className="demo" aria-label="Live demo: a dashboard generating and refining itself">
      <div className="demo__chrome">
        <span className="demo__dot" />
        <span className="demo__dot" />
        <span className="demo__dot" />
        <span className="demo__url">alpona · supply-chain</span>
      </div>

      <div className="demo__prompt">
        <Sparkles size={14} className="demo__prompt-icon" />
        <span>
          {isTyping ? text.slice(0, typed) : phase === 'refined' ? REFINE : PROMPT}
          {isTyping && <span className="demo__caret" />}
        </span>
        <span className={`demo__send ${isTyping ? '' : 'demo__send--active'}`}>
          {phase === 'refine-typing' || phase === 'refined' ? (
            <RefreshCw size={12} />
          ) : (
            <Wand2 size={12} />
          )}
        </span>
      </div>

      <div className={`demo__grid ${skeleton ? 'demo__grid--skeleton' : ''}`}>
        <div className="demo__widget demo__widget--kpi">
          <span className="demo__label">{skeleton ? '' : 'Late rate'}</span>
          <span className={`demo__kpi ${bound ? 'demo__kpi--in' : ''}`}>
            {skeleton ? '' : phase === 'refined' ? '19.2%' : '21.6%'}
          </span>
          {!skeleton && <span className="demo__delta">▲ vs last quarter</span>}
        </div>
        <div className="demo__widget demo__widget--chart">
          <span className="demo__label">
            {skeleton ? '' : phase === 'refined' ? 'Top 5 · weekly' : 'Delay by carrier'}
          </span>
          <div className="demo__bars">
            {bars.map((h, i) => (
              <span
                key={`${phase === 'refined' ? 'r' : 'f'}-${i}`}
                className="demo__bar"
                style={{
                  height: bound ? `${h}%` : '12%',
                  transitionDelay: `${i * 70}ms`,
                  opacity: skeleton ? 0.25 : 1,
                }}
              />
            ))}
          </div>
        </div>
        <div className="demo__widget demo__widget--rows">
          <span className="demo__label">{skeleton ? '' : 'Worst suppliers'}</span>
          {[72, 54, 38].map((w, i) => (
            <span key={i} className="demo__row" style={{ opacity: skeleton ? 0.25 : 1 }}>
              <span className="demo__row-bar" style={{ width: bound ? `${w}%` : '8%' }} />
            </span>
          ))}
        </div>
      </div>

      <div className="demo__status">
        {phase === 'typing' && 'describe it…'}
        {phase === 'skeleton' && '◈ planning — layout chosen, slots assigned'}
        {phase === 'binding' && '◈ binding — writing validated SQL per widget'}
        {phase === 'live' && '✓ live — every chart backed by guarded queries'}
        {phase === 'refine-typing' && 'refining…'}
        {phase === 'refined' && '✓ patched — only the chart that changed re-rendered'}
      </div>
    </div>
  );
}
