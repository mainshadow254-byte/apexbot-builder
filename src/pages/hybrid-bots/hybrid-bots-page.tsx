import React from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { Localize } from '@deriv-com/translations';
import './hybrid-bots.scss';

type TBot = { id: string; name: string; description: string; file: string; tag: string };

const CATALOG: TBot[] = [
    { id: 'martingale', name: 'Martingale Recovery', tag: 'Recovery', file: 'martingale.xml', description: 'Classic martingale - increases stake after a loss to recover. Set your own base stake and multiplier in Bot Builder.' },
    { id: 'martingale_cap', name: 'Martingale (Capped)', tag: 'Recovery', file: 'martingale_max-stake.xml', description: 'Martingale with a maximum-stake ceiling so the stake never runs away on a losing streak.' },
    { id: 'dalembert', name: "D'Alembert", tag: 'Balanced', file: 'dalembert.xml', description: 'Raises stake by one unit after a loss and lowers it after a win - gentler than martingale.' },
    { id: 'dalembert_cap', name: "D'Alembert (Capped)", tag: 'Balanced', file: 'dalembert_max-stake.xml', description: "D'Alembert with a max-stake limit for tighter risk control." },
    { id: 'rev_martingale', name: 'Reverse Martingale', tag: 'Aggressive', file: 'reverse_martingale.xml', description: 'Increases stake after a WIN to ride winning streaks; resets after a loss.' },
    { id: 'rev_dalembert', name: "Reverse D'Alembert", tag: 'Balanced', file: 'reverse_dalembert.xml', description: 'Raises stake after wins and lowers after losses in single-unit steps.' },
    { id: 'oscars', name: "Oscar's Grind", tag: 'Conservative', file: 'oscars_grind.xml', description: 'Aims for one unit of profit per cycle with slow, controlled stake increases.' },
    { id: 'oscars_cap', name: "Oscar's Grind (Capped)", tag: 'Conservative', file: 'oscars_grind_max-stake.xml', description: "Oscar's Grind with a maximum-stake cap for safer sessions." },
    { id: '1326', name: '1-3-2-6 System', tag: 'Structured', file: '1_3_2_6.xml', description: 'Fixed 4-step staking sequence (1-3-2-6 units) that locks in profit across a winning run.' },
    { id: 'acc_martingale', name: 'Accumulators Martingale', tag: 'Accumulators', file: 'accumulators_martingale.xml', description: 'Martingale recovery applied to Accumulator contracts.' },
    { id: 'acc_dalembert', name: "Accumulators D'Alembert", tag: 'Accumulators', file: 'accumulators_dalembert.xml', description: "D'Alembert staking applied to Accumulator contracts." },
    { id: 'acc_rev_martingale', name: 'Accumulators Reverse Martingale', tag: 'Accumulators', file: 'accumulators_reverse_martingale.xml', description: 'Reverse martingale applied to Accumulator contracts to ride streaks.' },
];

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
        </div>
    );
});

export default HybridBotsPage;
