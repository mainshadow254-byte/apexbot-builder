import React, { useEffect } from 'react';
import { initApexScanner } from '@/external/apex-scanner/apex-data-bridge';
import { mountApexOrb } from './orb';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import './orb.css';

const BOT_URLS: Record<string, string> = {
    'Rise / Fall': '/apex-bots/rise_fall.xml',
    'Even / Odd': '/apex-bots/even_odd.xml',
    'Over / Under': '/apex-bots/rise_fall.xml',
    'Matches / Differs': '/apex-bots/rise_fall.xml',
};

const ApexOrbMount: React.FC = () => {
    const { load_modal, dashboard } = useStore();

    useEffect(() => {
        let cancelled = false;

        const waitForWorkspace = (timeoutMs = 15000): Promise<boolean> =>
            new Promise(resolve => {
                const start = Date.now();
                const check = () => {
                    if ((window as any).Blockly?.derivWorkspace) return resolve(true);
                    if (Date.now() - start > timeoutMs) return resolve(false);
                    setTimeout(check, 200);
                };
                check();
            });

        const lookupSymbol = (symbol: string) => {
            const list = (window as any).symbolsList || [];
            return list.find((s: any) => s.symbol === symbol) || null;
        };

        // Loads the scanned bot INTO Bot Builder and STOPS.
        // The user sets stake and presses Run manually - the orb never auto-runs.
        (window as any).apexLoadAndRun = async (symbol: string, tradeType?: string) => {
            try {
                dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

                const ready = await waitForWorkspace();
                if (!ready) {
                    console.error('[ApexRun] Bot Builder workspace not ready.');
                    return { ok: false, reason: 'workspace_not_ready' };
                }

                const botUrl = BOT_URLS[tradeType as string] || '/apex-bots/rise_fall.xml';
                const res = await fetch(botUrl);
                if (!res.ok) {
                    console.error('[ApexRun] Failed to fetch bot XML:', res.status);
                    return { ok: false, reason: 'xml_fetch_failed' };
                }
                let xmlString = await res.text();

                const info = lookupSymbol(symbol);
                const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
                const setField = (name: string, value?: string) => {
                    if (!value) return;
                    doc.querySelectorAll(`field[name="${name}"]`).forEach(el => {
                        el.textContent = value;
                    });
                };
                if (info) {
                    setField('MARKET_LIST', info.market);
                    setField('SUBMARKET_LIST', info.submarket);
                    setField('SYMBOL_LIST', info.symbol);
                } else {
                    setField('SYMBOL_LIST', symbol);
                }
                xmlString = new XMLSerializer().serializeToString(doc);

                await load_modal.loadStrategyToBuilder(
                    {
                        id: `apex-${Date.now()}`,
                        xml: xmlString,
                        name: `ApexBot ${symbol}`,
                        save_type: 'local',
                    } as any,
                    true
                );

                return { ok: true, loaded: true };
            } catch (e) {
                console.error('[ApexRun] load failed:', e);
                return { ok: false, reason: (e as Error)?.message || 'unknown' };
            }
        };

        (async () => {
            await initApexScanner();
            if (!cancelled) {
                try {
                    mountApexOrb();
                } catch (e) {
                    console.error('[ApexOrb] mount failed:', e);
                }
            }
        })();

        return () => {
            cancelled = true;
            delete (window as any).apexLoadAndRun;
        };
    }, [load_modal, dashboard]);

    return null;
};

export default ApexOrbMount;
