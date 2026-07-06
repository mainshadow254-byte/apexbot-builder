import React from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { Localize } from '@deriv-com/translations';
import './hybrid-bots.scss';

type TBot = { id: string; name: string; description: string; file: string; tag: string };

const CATALOG: TBot[] = [];

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

const HybridBotsPage = observer(() => {
    const { load_modal, dashboard } = useStore();
    const [loadingId, setLoadingId] = React.useState('');

    const loadBot = async (bot: TBot) => {
        setLoadingId(bot.id);
        try {
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            const ready = await waitForWorkspace();
            if (!ready) {
                // eslint-disable-next-line no-console
                console.error('[HybridBots] workspace not ready');
                return;
            }
            const res = await fetch(`/apex-bots/${bot.file}`);
            if (!res.ok) {
                // eslint-disable-next-line no-console
                console.error('[HybridBots] fetch failed', res.status);
                return;
            }
            const xml = await res.text();
            await load_modal.loadStrategyToBuilder(
                { id: `hybrid-${bot.id}-${Date.now()}`, xml, name: bot.name, save_type: 'local' } as any,
                true
            );
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[HybridBots] load failed', e);
        } finally {
            setLoadingId('');
        }
    };

    return (
        <div className='apex-hybrid'>
            <div className='apex-hybrid__intro'>
                <Text as='h2' weight='bold' size='m' color='prominent' lineHeight='xxl'>
                    <Localize i18n_default_text='Hybrid Bots' />
                </Text>
                <Text as='p' color='prominent' size='xs' lineHeight='l'>
                    <Localize i18n_default_text='Curated ready-to-run bots. Tap Load to open one in the Bot Builder - then set your stake, your martingale value, and press Run.' />
                </Text>
            </div>

            {CATALOG.length === 0 ? (
                <div className='apex-hybrid__empty'>
                    <div className='apex-hybrid__empty-icon'>🧩</div>
                    <Text as='p' weight='bold' size='s' color='prominent'>
                        <Localize i18n_default_text='Hybrid bots coming soon' />
                    </Text>
                    <Text as='p' size='xs' color='less-prominent' lineHeight='l'>
                        <Localize i18n_default_text='Curated hybrid strategies will appear here soon. Check back shortly.' />
                    </Text>
                </div>
            ) : (
                <div className='apex-hybrid__grid'>
                    {CATALOG.map(bot => (
                        <div className='apex-hybrid__card' key={bot.id}>
                            <span className='apex-hybrid__tag'>{bot.tag}</span>
                            <div className='apex-hybrid__name'>{bot.name}</div>
                            <div className='apex-hybrid__desc'>{bot.description}</div>
                            <button
                                className='apex-hybrid__load'
                                disabled={loadingId === bot.id}
                                onClick={() => loadBot(bot)}
                            >
                                {loadingId === bot.id ? 'Loading...' : 'Load'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

export default HybridBotsPage;
