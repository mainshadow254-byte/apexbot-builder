import React, { useEffect } from 'react';
import { initApexScanner } from '@/external/apex-scanner/apex-data-bridge';
import { mountApexOrb } from './orb';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import './orb.css';

const RISE_FALL_BOT_URL = '/apex-bots/rise_fall.xml';

const ApexOrbMount: React.FC = () => {
    const { load_modal, run_panel, dashboard } = useStore();
    const root_store = useStore();

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

        (window as any).apexLoadAndRun = async (symbol: string) => {
            try {
                // 1. Switch to Bot Builder so Blockly initializes
                dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

                // 2. Wait for the Blockly workspace to be ready
                const ready = await waitForWorkspace();
                if (!ready) {
                    // eslint-disable-next-line no-console
                    console.error('[ApexRun] Bot Builder workspace not ready.');
                    return { ok: false, reason: 'workspace_not_ready' };
                }

                // 3. Fetch the Rise/Fall sample bot
                const res = await fetch(RISE_FALL_BOT_URL);
                if (!res.ok) {
                    // eslint-disable-next-line no-console
                    console.error('[ApexRun] Failed to fetch bot XML:', res.status);
                    return { ok: false, reason: 'xml_fetch_failed' };
                }
                let xmlString = await res.text();

                // 4. Override market/submarket/symbol in the XML DOM
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

                // 5. Load into the Bot Builder
                await load_modal.loadStrategyToBuilder(
                    {
                        id: `apex-${Date.now()}`,
                        xml: xmlString,
                        name: `ApexBot ${symbol}`,
                        save_type: 'local',
                    } as any,
                    true
                );

                // 6. Pre-check login so we can report the truth
                const client = (root_store as any)?.core?.client;
                if (client && client.is_logged_in === false) {
                    return { ok: false, reason: 'not_logged_in' };
                }

                // 7. Let Blockly settle, then run
                await new Promise(r => setTimeout(r, 600));
                await run_panel.onRunButtonClick();

                // 8. Verify the bot ACTUALLY started (engine may block: login, invalid strategy, etc.)
                await new Promise(r => setTimeout(r, 500));
                const is_running = (run_panel as any)?.is_running === true;
                if (!is_running) {
                    return { ok: false, reason: 'run_blocked' };
                }

                return { ok: true };
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('[ApexRun] apexLoadAndRun failed:', e);
                return { ok: false, reason: (e as Error)?.message || 'unknown' };
            }
        };

        (async () => {
            await initApexScanner();
            if (!cancelled) {
                try {
                    mountApexOrb();
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error('[ApexOrb] mount failed:', e);
                }
            }
        })();

        return () => {
            cancelled = true;
            delete (window as any).apexLoadAndRun;
        };
    }, [load_modal, run_panel, dashboard]);

    return null;
};

export default ApexOrbMount;
