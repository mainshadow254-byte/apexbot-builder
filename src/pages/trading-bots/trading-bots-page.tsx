import React from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { getSavedWorkspaces } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { Localize } from '@deriv-com/translations';
import DashboardBotList from '@/pages/dashboard/bot-list/dashboard-bot-list';

const TradingBotsPage = observer(() => {
    const { load_modal } = useStore();
    const { dashboard_strategies, setDashboardStrategies } = load_modal;
    const [loaded, setLoaded] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const recent = await getSavedWorkspaces();
            if (!cancelled) {
                setDashboardStrategies(recent);
                setLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [setDashboardStrategies]);

    const has_strategies = !!dashboard_strategies?.length;

    return (
        <div style={{ padding: '2.4rem', height: '100%', overflowY: 'auto', width: '100%' }}>
            <Text as='h2' weight='bold' size='m' color='prominent' lineHeight='xxl'>
                <Localize i18n_default_text='Trading Bots' />
            </Text>
            <Text as='p' color='prominent' size='xs' lineHeight='l'>
                <Localize i18n_default_text='Your saved and recently used bots. Tap a bot to load it into the Bot Builder - then set your stake and press Run.' />
            </Text>

            <div style={{ marginTop: '1.6rem' }}>
                {has_strategies ? (
                    <DashboardBotList />
                ) : loaded ? (
                    <div
                        style={{
                            marginTop: '3rem',
                            padding: '3rem',
                            border: '1px dashed var(--border-normal)',
                            borderRadius: '12px',
                            textAlign: 'center',
                            color: 'var(--text-less-prominent)',
                            maxWidth: '520px',
                        }}
                    >
                        <Text as='p' size='xs' color='prominent' lineHeight='l'>
                            <Localize i18n_default_text='No saved bots yet. Build or import a bot in the Bot Builder, or load one from the AI Scanner - your bots will be listed here for quick re-loading.' />
                        </Text>
                    </div>
                ) : null}
            </div>
        </div>
    );
});

export default TradingBotsPage;
