import { useCallback, useEffect, useRef, useState } from 'react';
import './apex-launch.scss';

const LOG_LINES = [
    'Initializing Apex Core…',
    'Preparing Deriv workspace…',
    'Loading strategy modules…',
    'Checking risk controls…',
    'Syncing market interface…',
    'Calibrating signal engine…',
    'Awaiting access code…',
];

const MARKET_CARDS = [
    { key: 'vol', label: 'Volatility', hint: 'streaming', accent: 'cyan' },
    { key: 'step', label: 'Step Index', hint: 'linked', accent: 'blue' },
    { key: 'boom', label: 'Boom / Crash', hint: 'armed', accent: 'gold' },
    { key: 'risk', label: 'Risk Control', hint: 'checking', accent: 'green' },
    { key: 'strat', label: 'Strategy Builder', hint: 'ready', accent: 'cyan' },
];

const SESSION_KEY = 'apex_launch_seen';
const ACCESS_PIN = '1960';
const PIN_LENGTH = 4;
const DURATION = 4200;

const reducedMotion = () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ApexLaunch = () => {
    const [mounted, setMounted] = useState<boolean>(() => {
        try {
            return sessionStorage.getItem(SESSION_KEY) !== '1';
        } catch {
            return true;
        }
    });
    const [phase, setPhase] = useState<'boot' | 'pin'>('boot');
    const [closing, setClosing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [logIdx, setLogIdx] = useState(0);
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const rafRef = useRef<number | undefined>(undefined);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const doneRef = useRef(false);
    const bootDoneRef = useRef(false);

    const finish = useCallback(() => {
        if (doneRef.current) return;
        doneRef.current = true;
        try {
            sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
            /* ignore */
        }
        setClosing(true);
        window.setTimeout(() => setMounted(false), 650);
    }, []);

    const enterPinPhase = useCallback(() => {
        if (bootDoneRef.current) return;
        bootDoneRef.current = true;
        setProgress(100);
        setLogIdx(LOG_LINES.length - 1);
        setPhase('pin');
    }, []);

    useEffect(() => {
        if (!mounted || phase !== 'boot') return;
        const dur = reducedMotion() ? 700 : DURATION;
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / dur);
            const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            setProgress(Math.round(eased * 100));
            setLogIdx(Math.min(LOG_LINES.length - 1, Math.floor(t * LOG_LINES.length)));
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
            else enterPinPhase();
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [mounted, phase, enterPinPhase]);

    const submitPin = useCallback(
        (value: string) => {
            if (value === ACCESS_PIN) {
                setError(false);
                finish();
            } else {
                setError(true);
                window.setTimeout(() => {
                    setPin('');
                    setError(false);
                }, 620);
            }
        },
        [finish]
    );

    const pushDigit = useCallback(
        (d: string) => {
            setError(false);
            setPin(prev => {
                if (prev.length >= PIN_LENGTH) return prev;
                const next = prev + d;
                if (next.length === PIN_LENGTH) window.setTimeout(() => submitPin(next), 120);
                return next;
            });
        },
        [submitPin]
    );

    const backspace = useCallback(() => {
        setError(false);
        setPin(prev => prev.slice(0, -1));
    }, []);

    useEffect(() => {
        if (!mounted || phase !== 'pin') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key >= '0' && e.key <= '9') pushDigit(e.key);
            else if (e.key === 'Backspace') backspace();
            else if (e.key === 'Enter' && pin.length === PIN_LENGTH) submitPin(pin);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [mounted, phase, pin, pushDigit, backspace, submitPin]);

    useEffect(() => {
        if (!mounted || reducedMotion()) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        let w = (canvas.width = canvas.offsetWidth * dpr);
        let h = (canvas.height = canvas.offsetHeight * dpr);

        const particles = Array.from({ length: 46 }, () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 1.8 * dpr + 0.4,
            vx: (Math.random() - 0.5) * 0.25 * dpr,
            vy: (Math.random() - 0.5) * 0.25 * dpr,
            a: Math.random() * 0.5 + 0.2,
        }));

        const pts: number[] = [];
        let base = h * 0.62;
        for (let i = 0; i <= 60; i++) {
            base += (Math.random() - 0.46) * h * 0.03;
            base = Math.max(h * 0.3, Math.min(h * 0.8, base));
            pts.push(base);
        }
        let ph = 0;

        const onResize = () => {
            w = canvas.width = canvas.offsetWidth * dpr;
            h = canvas.height = canvas.offsetHeight * dpr;
        };
        window.addEventListener('resize', onResize);

        let raf = 0;
        const draw = () => {
            ctx.clearRect(0, 0, w, h);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0) p.x = w;
                if (p.x > w) p.x = 0;
                if (p.y < 0) p.y = h;
                if (p.y > h) p.y = 0;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(47,227,255,${p.a})`;
                ctx.fill();
            });
            ph += 0.01;
            ctx.beginPath();
            const step = w / (pts.length - 1);
            pts.forEach((y, i) => {
                const yy = y + Math.sin(ph + i * 0.3) * 3 * dpr;
                if (i === 0) ctx.moveTo(0, yy);
                else ctx.lineTo(i * step, yy);
            });
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, 'rgba(61,139,255,0)');
            grad.addColorStop(0.4, 'rgba(47,227,255,0.9)');
            grad.addColorStop(0.75, 'rgba(47,227,139,0.9)');
            grad.addColorStop(1, 'rgba(255,198,77,0)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2 * dpr;
            ctx.shadowColor = 'rgba(47,227,255,0.8)';
            ctx.shadowBlur = 14 * dpr;
            ctx.stroke();
            ctx.shadowBlur = 0;
            raf = requestAnimationFrame(draw);
        };
        draw();
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
        };
    }, [mounted]);

    if (!mounted) return null;

    const isPin = phase === 'pin';

    return (
        <div
            className={`apex-launch${closing ? ' apex-launch--closing' : ''}`}
            role='status'
            aria-live='polite'
            aria-label='ApexTraders launching'
        >
            <canvas ref={canvasRef} className='apex-launch__canvas' />
            <div className='apex-launch__grid' />

            {!isPin && (
                <button type='button' className='apex-launch__skip' onClick={enterPinPhase}>
                    Skip →
                </button>
            )}

            <div className='apex-launch__brand'>
                <span className='apex-launch__brand-mark'>A</span>
                <span className='apex-launch__brand-name'>ApexTraders</span>
                <span className='apex-launch__brand-tag'>Launch Mode</span>
            </div>

            <div className='apex-launch__stage'>
                <div className='apex-launch__cards'>
                    {MARKET_CARDS.map((c, i) => (
                        <div
                            key={c.key}
                            className={`apex-launch__card apex-launch__card--${c.accent}`}
                            style={{ animationDelay: `${i * 0.12}s` }}
                        >
                            <span className='apex-launch__card-label'>{c.label}</span>
                            <span className='apex-launch__card-hint'>{c.hint}</span>
                        </div>
                    ))}
                </div>

                <div className='apex-launch__core'>
                    <div
                        className='apex-launch__ring'
                        style={{
                            background: `conic-gradient(#2fe3ff ${progress * 3.6}deg, rgba(255,255,255,0.06) 0deg)`,
                        }}
                    >
                        <div className='apex-launch__core-inner'>
                            {!isPin ? (
                                <>
                                    <div className='apex-launch__pct'>
                                        {progress}
                                        <i>%</i>
                                    </div>
                                    <div className='apex-launch__core-label'>APEX CORE</div>
                                </>
                            ) : (
                                <div className='apex-launch__lock'>🔒</div>
                            )}
                        </div>
                    </div>
                    <div className='apex-launch__pulse' />
                    <div className='apex-launch__pulse apex-launch__pulse--2' />
                </div>
            </div>

            {!isPin ? (
                <>
                    <div className='apex-launch__terminal'>
                        <div className='apex-launch__terminal-bar'>
                            <span />
                            <span />
                            <span />
                            <em>apex-engine</em>
                        </div>
                        <div className='apex-launch__log'>
                            {LOG_LINES.slice(0, logIdx + 1).map((l, i) => (
                                <div
                                    key={i}
                                    className={`apex-launch__log-line${i === logIdx ? ' is-active' : ''}`}
                                >
                                    <b>›</b> {l}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className='apex-launch__bar'>
                        <div className='apex-launch__bar-fill' style={{ width: `${progress}%` }} />
                    </div>
                </>
            ) : (
                <div className={`apex-launch__pinbox${error ? ' apex-launch__pinbox--err' : ''}`}>
                    <div className='apex-launch__pin-title'>ENTER ACCESS CODE</div>
                    <div className='apex-launch__pin-dots'>
                        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                            <span key={i} className={`apex-launch__pin-dot${i < pin.length ? ' is-filled' : ''}`} />
                        ))}
                    </div>
                    <div className='apex-launch__pin-msg'>{error ? 'Incorrect code — try again' : '\u00A0'}</div>
                    <div className='apex-launch__keypad'>
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                            <button key={d} type='button' className='apex-launch__key' onClick={() => pushDigit(d)}>
                                {d}
                            </button>
                        ))}
                        <span className='apex-launch__key apex-launch__key--ghost' />
                        <button type='button' className='apex-launch__key' onClick={() => pushDigit('0')}>
                            0
                        </button>
                        <button
                            type='button'
                            className='apex-launch__key apex-launch__key--del'
                            onClick={backspace}
                            aria-label='Delete'
                        >
                            ⌫
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ApexLaunch;
