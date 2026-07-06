import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';

export type TConn = 'connecting' | 'live' | 'reconnecting' | 'stale' | 'disconnected';
type TTick = { epoch: number; quote: number };

const MAX = 1000;
const STALE_MS = 8000;

function resolveDecimals(pip: any, sample?: string): number {
    if (pip != null) {
        const v = Number(pip);
        if (!isNaN(v)) {
            if (v > 0 && v < 1) return Math.round(-Math.log10(v));
            if (v >= 1 && v <= 8) return Math.round(v);
        }
    }
    if (sample && sample.indexOf('.') > -1) return sample.split('.')[1].length;
    return 2;
}

export function useDigitTicks(symbol: string) {
    const [conn, setConn] = useState<TConn>('connecting');
    const [version, setVersion] = useState(0);

    const ticksRef = useRef<TTick[]>([]);
    const decimalsRef = useRef(2);
    const lastEpochRef = useRef(0);
    const subRef = useRef<any>(null);
    const subIdRef = useRef('');
    const lastMsgAtRef = useRef(Date.now());
    const activeRef = useRef(symbol);
    const watchdogRef = useRef<any>(null);

    useEffect(() => {
        let cancelled = false;
        activeRef.current = symbol;
        ticksRef.current = [];
        lastEpochRef.current = 0;
        setConn('connecting');

        const cleanup = () => {
            if (watchdogRef.current) clearInterval(watchdogRef.current);
            if (subRef.current) {
                try {
                    subRef.current.unsubscribe();
                } catch (e) {
                    /* noop */
                }
                subRef.current = null;
            }
            if (subIdRef.current) {
                try {
                    api_base?.api?.send({ forget: subIdRef.current });
                } catch (e) {
                    /* noop */
                }
                subIdRef.current = '';
            }
        };

        const accept = (epoch: number, quote: number) => {
            if (epoch <= lastEpochRef.current) return;
            lastEpochRef.current = epoch;
            lastMsgAtRef.current = Date.now();
            const arr = ticksRef.current;
            arr.push({ epoch, quote });
            if (arr.length > MAX) arr.shift();
            setConn('live');
            setVersion(v => v + 1);
        };

        const start = async () => {
            cleanup();
            try {
                if (!api_base?.api) {
                    setConn('disconnected');
                    return;
                }

                let pip: any = null;
                try {
                    const ps: any = (api_base as any)?.pip_sizes;
                    pip = ps && (ps[symbol] ?? (ps.get ? ps.get(symbol) : null));
                } catch (e) {
                    /* noop */
                }

                const res: any = await api_base.api.send({
                    ticks_history: symbol,
                    end: 'latest',
                    count: MAX,
                    style: 'ticks',
                    subscribe: 1,
                });
                if (cancelled || activeRef.current !== symbol) {
                    cleanup();
                    return;
                }
                if (res?.error) {
                    setConn('disconnected');
                    return;
                }

                subIdRef.current = res?.subscription?.id || '';
                const prices: any[] = res?.history?.prices || [];
                const times: any[] = res?.history?.times || [];
                const sample = prices.length ? String(prices[prices.length - 1]) : undefined;
                decimalsRef.current = resolveDecimals(pip, sample);

                const seeded: TTick[] = [];
                for (let i = 0; i < prices.length; i++) {
                    seeded.push({ epoch: Number(times[i]) || i, quote: Number(prices[i]) });
                }
                ticksRef.current = seeded.slice(-MAX);
                lastEpochRef.current = seeded.length ? seeded[seeded.length - 1].epoch : 0;
                lastMsgAtRef.current = Date.now();
                setConn('live');
                setVersion(v => v + 1);

                subRef.current = api_base.api.onMessage().subscribe(({ data }: any) => {
                    if (cancelled || activeRef.current !== symbol) return;
                    if (data?.msg_type === 'tick' && data.tick && data.tick.symbol === symbol) {
                        accept(Number(data.tick.epoch), Number(data.tick.quote));
                    }
                });

                watchdogRef.current = setInterval(() => {
                    if (cancelled) return;
                    const idle = Date.now() - lastMsgAtRef.current;
                    if (idle > STALE_MS) {
                        const rs = (api_base as any)?.api?.connection?.readyState;
                        if (rs === 1) {
                            setConn('reconnecting');
                            start();
                        } else {
                            setConn(prev => (prev === 'live' ? 'stale' : 'disconnected'));
                        }
                    }
                }, 3000);
            } catch (e) {
                if (!cancelled) setConn('disconnected');
            }
        };

        start();

        const onVis = () => {
            if (document.visibilityState === 'visible') {
                const idle = Date.now() - lastMsgAtRef.current;
                if (idle > STALE_MS) {
                    setConn('reconnecting');
                    start();
                }
            }
        };
        document.addEventListener('visibilitychange', onVis);

        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', onVis);
            cleanup();
        };
    }, [symbol]);

    return { conn, version, ticks: ticksRef.current, decimals: decimalsRef.current };
}
