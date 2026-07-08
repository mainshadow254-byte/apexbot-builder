import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import './account-limits-modal.scss';

type TLimits = {
    account_balance?: number;
    daily_turnover?: number;
    open_positions?: number;
    payout?: number;
    num_of_days?: number;
    num_of_days_limit?: number;
    remainder?: number;
    withdrawal_since_inception_monetary?: number;
};

const AccountLimitsModal = ({ onClose }: { onClose: () => void }) => {
    const { client } = useStore();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [limits, setLimits] = useState<TLimits | null>(null);

    useEffect(() => {
        let active = true;

        (async () => {
            try {
                if (!api_base?.api) throw new Error('Connection not ready');
                const res: any = await api_base.api.send({ get_limits: 1 });
                if (!active) return;
                if (res?.error) throw new Error(res.error.message || 'Could not load limits');
                setLimits(res.get_limits || {});
            } catch (e: any) {
                if (active) setError(e?.message || 'Could not load account limits');
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const cur = client?.currency || 'USD';
    const fmt = (v?: number) => (v === undefined || v === null ? '-' : `${Number(v).toLocaleString()} ${cur}`);

    return (
        <div className='apex-alimits__overlay' onClick={onClose}>
            <div className='apex-alimits' onClick={e => e.stopPropagation()}>
                <div className='apex-alimits__header'>
                    <span>Account Limits</span>
                    <button className='apex-alimits__close' onClick={onClose} aria-label='Close'>
                        x
                    </button>
                </div>

                <div className='apex-alimits__acct'>
                    <span>{client?.loginid || '-'}</span>
                    <span>{cur}</span>
                </div>

                {loading && <div className='apex-alimits__state'>Loading your limits...</div>}
                {!loading && error && (
                    <div className='apex-alimits__state apex-alimits__state--err'>
                        {error}
                        <a href='https://deriv.com/account/account-limits' target='_blank' rel='noopener noreferrer'>
                            View on Deriv
                        </a>
                    </div>
                )}

                {!loading && !error && limits && (
                    <div className='apex-alimits__grid'>
                        <div className='apex-alimits__row'>
                            <span>Max open positions</span>
                            <b>{limits.open_positions ?? '-'}</b>
                        </div>
                        <div className='apex-alimits__row'>
                            <span>Max account balance</span>
                            <b>{fmt(limits.account_balance)}</b>
                        </div>
                        <div className='apex-alimits__row'>
                            <span>Max daily turnover</span>
                            <b>{fmt(limits.daily_turnover)}</b>
                        </div>
                        <div className='apex-alimits__row'>
                            <span>Max aggregate payout (open)</span>
                            <b>{fmt(limits.payout)}</b>
                        </div>
                        <div className='apex-alimits__sep' />
                        <div className='apex-alimits__row'>
                            <span>Withdrawal limit ({limits.num_of_days ?? 0} days)</span>
                            <b>{fmt(limits.num_of_days_limit)}</b>
                        </div>
                        <div className='apex-alimits__row'>
                            <span>Withdrawn since inception</span>
                            <b>{fmt(limits.withdrawal_since_inception_monetary)}</b>
                        </div>
                        <div className='apex-alimits__row'>
                            <span>Remaining withdrawal</span>
                            <b>{fmt(limits.remainder)}</b>
                        </div>
                        <a
                            className='apex-alimits__link'
                            href='https://deriv.com/account/account-limits'
                            target='_blank'
                            rel='noopener noreferrer'
                        >
                            Full details on Deriv
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
};

export default observer(AccountLimitsModal);
