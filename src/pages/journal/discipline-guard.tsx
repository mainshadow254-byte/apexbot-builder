import React from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { LocalStore } from '@/components/shared';
import type { TContractInfo } from '@/components/summary/summary-card.types';
import { transaction_elements } from '@/constants/transactions';
import { useStore } from '@/hooks/useStore';
import { Localize } from '@deriv-com/translations';
import './discipline-guard.scss';

const LIMITS_KEY = 'apex.discipline_limits';

const DisciplineGuard = observer(() => {
    const { transactions, run_panel } = useStore();
    const { run_id } = run_panel;

    const [maxLosses, setMaxLosses] = React.useState<number>(3);
    const [lossCap, setLossCap] = React.useState<number>(0);
    const [showLimits, setShowLimits] = React.useState<boolean>(false);
    const [dismissed, setDismissed] = React.useState<string>('');

    React.useEffect(() => {
        try {
            const saved = LocalStore.get(LIMITS_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.maxLosses != null) setMaxLosses(Number(parsed.maxLosses));
                if (parsed.lossCap != null) setLossCap(Number(parsed.lossCap));
            }
        } catch {
            /* ignore invalid local settings */
        }
    }, []);

    const persist = (next_max_losses: number, next_loss_cap: number) => {
        try {
            LocalStore.set(LIMITS_KEY, JSON.stringify({ maxLosses: next_max_losses, lossCap: next_loss_cap }));
        } catch {
            /* ignore unavailable local storage */
        }
    };

    const list = transactions.transactions;
    const stats = transactions.statistics;

    const completed = React.useMemo(
        () =>
            list
                .filter(
                    transaction =>
                        transaction.type === transaction_elements.CONTRACT &&
                        typeof transaction.data === 'object' &&
                        (transaction.data as TContractInfo).is_completed
                )
                .map(transaction => transaction.data as TContractInfo),
        [list]
    );

    let lossStreak = 0;
    for (const contract of completed) {
        if ((Number(contract.profit) || 0) < 0) lossStreak += 1;
        else break;
    }

    const sessionRunId = run_id || completed[0]?.run_id || '';
    const sessionPL = completed
        .filter(contract => contract.run_id === sessionRunId)
        .reduce((sum, contract) => sum + (Number(contract.profit) || 0), 0);

    const wins = stats.won_contracts;
    const losses = stats.lost_contracts;
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    const totalProfit = Number(stats.total_profit) || 0;

    let banner: { level: 'stop' | 'warn'; text: string; key: string } | null = null;
    if (lossCap > 0 && sessionPL <= -Math.abs(lossCap)) {
        banner = {
            level: 'stop',
            key: `cap-${sessionRunId}-${Math.round(sessionPL)}`,
            text: `Session loss limit reached (${sessionPL.toFixed(2)}). The AI suggests stopping and taking a break.`,
        };
    } else if (maxLosses > 0 && lossStreak >= maxLosses) {
        banner = {
            level: 'warn',
            key: `streak-${sessionRunId}-${lossStreak}`,
            text: `${lossStreak} losses in a row. Consider pausing - chasing losses is how accounts blow up.`,
        };
    }

    const showBanner = banner && banner.key !== dismissed;
    const formatProfit = (value: number) => (value >= 0 ? '+' : '') + value.toFixed(2);

    return (
        <div className='apex-discipline'>
            {showBanner && banner && (
                <div className={`apex-discipline__banner apex-discipline__banner--${banner.level}`}>
                    <span className='apex-discipline__banner-icon'>{banner.level === 'stop' ? 'STOP' : '!'}</span>
                    <Text as='p' size='xs' weight='bold' lineHeight='m'>
                        {banner.text}
                    </Text>
                    <button
                        aria-label='Dismiss discipline warning'
                        className='apex-discipline__banner-x'
                        onClick={() => setDismissed(banner.key)}
                    >
                        x
                    </button>
                </div>
            )}

            <div className='apex-discipline__stats'>
                <div className='apex-discipline__stat'>
                    <span className='apex-discipline__stat-label'>Win rate</span>
                    <span className='apex-discipline__stat-value'>{totalTrades ? `${winRate}%` : '-'}</span>
                </div>
                <div className='apex-discipline__stat'>
                    <span className='apex-discipline__stat-label'>Wins / Losses</span>
                    <span className='apex-discipline__stat-value'>
                        <b className='is-win'>{wins}</b> / <b className='is-loss'>{losses}</b>
                    </span>
                </div>
                <div className='apex-discipline__stat'>
                    <span className='apex-discipline__stat-label'>Loss streak</span>
                    <span
                        className={`apex-discipline__stat-value ${
                            lossStreak >= maxLosses && maxLosses > 0 ? 'is-loss' : ''
                        }`}
                    >
                        {lossStreak}
                    </span>
                </div>
                <div className='apex-discipline__stat'>
                    <span className='apex-discipline__stat-label'>Session P/L</span>
                    <span className={`apex-discipline__stat-value ${sessionPL >= 0 ? 'is-win' : 'is-loss'}`}>
                        {completed.length ? formatProfit(sessionPL) : '-'}
                    </span>
                </div>
                <div className='apex-discipline__stat'>
                    <span className='apex-discipline__stat-label'>Total P/L</span>
                    <span className={`apex-discipline__stat-value ${totalProfit >= 0 ? 'is-win' : 'is-loss'}`}>
                        {totalTrades ? formatProfit(totalProfit) : '-'}
                    </span>
                </div>
                <button className='apex-discipline__limits-toggle' onClick={() => setShowLimits(value => !value)}>
                    {showLimits ? 'Hide limits' : 'Set my limits'}
                </button>
            </div>

            {showLimits && (
                <div className='apex-discipline__limits'>
                    <label>
                        <span>Warn after this many losses in a row</span>
                        <input
                            min={0}
                            type='number'
                            value={maxLosses}
                            onChange={event => {
                                const value = Math.max(0, Number(event.target.value) || 0);
                                setMaxLosses(value);
                                persist(value, lossCap);
                            }}
                        />
                    </label>
                    <label>
                        <span>Session loss limit (0 = off)</span>
                        <input
                            min={0}
                            type='number'
                            value={lossCap}
                            onChange={event => {
                                const value = Math.max(0, Number(event.target.value) || 0);
                                setLossCap(value);
                                persist(maxLosses, value);
                            }}
                        />
                    </label>
                </div>
            )}

            <Text as='p' size='xxs' color='less-prominent' lineHeight='m' className='apex-discipline__note'>
                <Localize i18n_default_text='These are real results from your completed trades. This guard advises only - it never stops your bot. Past performance does not guarantee future results.' />
            </Text>
        </div>
    );
});

export default DisciplineGuard;
