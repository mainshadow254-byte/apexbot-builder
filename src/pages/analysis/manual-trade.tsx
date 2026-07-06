import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import './manual-trade.scss';

type TProps = { symbol: string };

type TTradeType = {
    key: string;
    label: string;
    needsDigit: boolean;
    range?: [number, number];
};

const TRADE_TYPES: TTradeType[] = [
    { key: 'DIGITMATCH', label: 'Matches', needsDigit: true, range: [0, 9] },
    { key: 'DIGITDIFF', label: 'Differs', needsDigit: true, range: [0, 9] },
    { key: 'DIGITEVEN', label: 'Even', needsDigit: false },
    { key: 'DIGITODD', label: 'Odd', needsDigit: false },
    { key: 'DIGITOVER', label: 'Over', needsDigit: true, range: [0, 8] },
    { key: 'DIGITUNDER', label: 'Under', needsDigit: true, range: [1, 9] },
];

const ManualTrade = observer(({ symbol }: TProps) => {
    const { client } = useStore();
    const currency = (client as any)?.currency || 'USD';
    const is_logged_in = !!(client as any)?.is_logged_in;

    const [tradeType, setTradeType] = useState('DIGITEVEN');
    const [prediction, setPrediction] = useState(5);
    const [stake, setStake] = useState(1);
    const [duration, setDuration] = useState(1);
    const [proposal, setProposal] = useState<any>(null);
    const [proposalError, setProposalError] = useState('');
    const [buying, setBuying] = useState(false);
    const [contract, setContract] = useState<any>(null);
    const [status, setStatus] = useState('');
    const [statusKind, setStatusKind] = useState<'' | 'win' | 'loss'>('');

    const propSubIdRef = useRef('');
    const propMsgSubRef = useRef<any>(null);
    const pocSubIdRef = useRef('');
    const pocMsgSubRef = useRef<any>(null);

    const meta = TRADE_TYPES.find(t => t.key === tradeType) as TTradeType;
    const needsDigit = meta.needsDigit;

    useEffect(() => {
        if (!needsDigit || !meta.range) return;
        const [min, max] = meta.range;
        setPrediction(p => (p < min ? min : p > max ? max : p));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tradeType]);

    const clearProposalSub = () => {
        const api = (api_base as any)?.api;
        if (propMsgSubRef.current) {
            try {
                propMsgSubRef.current.unsubscribe();
            } catch (e) {
                /* ignore */
            }
            propMsgSubRef.current = null;
        }
        if (propSubIdRef.current) {
            try {
                api?.send({ forget: propSubIdRef.current });
            } catch (e) {
                /* ignore */
            }
            propSubIdRef.current = '';
        }
    };

    const clearPocSub = () => {
        const api = (api_base as any)?.api;
        if (pocMsgSubRef.current) {
            try {
                pocMsgSubRef.current.unsubscribe();
            } catch (e) {
                /* ignore */
            }
            pocMsgSubRef.current = null;
        }
        if (pocSubIdRef.current) {
            try {
                api?.send({ forget: pocSubIdRef.current });
            } catch (e) {
                /* ignore */
            }
            pocSubIdRef.current = '';
        }
    };

    const buildProposalReq = () => {
        const req: any = {
            proposal: 1,
            subscribe: 1,
            amount: Number(stake),
            basis: 'stake',
            contract_type: tradeType,
            currency,
            duration: Number(duration),
            duration_unit: 't',
            underlying_symbol: symbol,
        };
        if (needsDigit) req.barrier = String(prediction);
        return req;
    };

    useEffect(() => {
        const api = (api_base as any)?.api;
        if (!symbol || !is_logged_in || !api) {
            setProposal(null);
            return;
        }
        if (!stake || Number(stake) <= 0 || !duration || Number(duration) < 1) {
            setProposal(null);
            setProposalError('Enter a valid stake and duration.');
            return;
        }
        let cancelled = false;
        setProposalError('');

        const timer = setTimeout(async () => {
            clearProposalSub();
            try {
                const res: any = await api.send(buildProposalReq());
                if (cancelled) {
                    if (res?.subscription?.id) api.send({ forget: res.subscription.id });
                    return;
                }
                if (res?.error) {
                    setProposalError(res.error.message || 'Invalid parameters');
                    setProposal(null);
                    return;
                }

                propSubIdRef.current = res?.subscription?.id || '';
                setProposal(res?.proposal || null);

                propMsgSubRef.current = api.onMessage().subscribe(({ data }: any) => {
                    if (
                        data?.msg_type === 'proposal' &&
                        data?.subscription?.id &&
                        data.subscription.id === propSubIdRef.current
                    ) {
                        setProposal(data.proposal);
                    }
                });
            } catch (e: any) {
                if (!cancelled) {
                    setProposalError(e?.error?.message || e?.message || 'Could not get price');
                    setProposal(null);
                }
            }
        }, 450);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            clearProposalSub();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, tradeType, prediction, stake, duration, is_logged_in, currency]);

    useEffect(
        () => () => {
            clearProposalSub();
            clearPocSub();
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const handlePoc = (nextContract: any) => {
        setContract(nextContract);
        if (nextContract.is_sold) {
            const profit = Number(nextContract.profit);
            setStatusKind(profit >= 0 ? 'win' : 'loss');
            setStatus(
                profit >= 0 ? `WON +${profit.toFixed(2)} ${currency}` : `LOST ${profit.toFixed(2)} ${currency}`
            );
            setBuying(false);
            clearPocSub();
        } else {
            setStatusKind('');
            setStatus('Contract open - watching ticks...');
        }
    };

    const monitorContract = async (contract_id: string) => {
        const api = (api_base as any)?.api;
        if (!api) return;
        clearPocSub();
        try {
            const res: any = await api.send({
                proposal_open_contract: 1,
                contract_id,
                subscribe: 1,
            });
            pocSubIdRef.current = res?.subscription?.id || '';
            if (res?.proposal_open_contract) handlePoc(res.proposal_open_contract);

            pocMsgSubRef.current = api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type === 'proposal_open_contract') {
                    const openContract = data.proposal_open_contract;
                    if (openContract && String(openContract.contract_id) === String(contract_id)) {
                        handlePoc(openContract);
                    }
                }
            });
        } catch (e: any) {
            setStatus('Monitor failed: ' + (e?.error?.message || e?.message || 'unknown'));
            setBuying(false);
        }
    };

    const handleBuy = async () => {
        const api = (api_base as any)?.api;
        if (!proposal?.id || buying || !api) return;
        setBuying(true);
        setStatusKind('');
        setStatus('Placing trade...');
        setContract(null);
        try {
            const res: any = await api.send({ buy: proposal.id, price: proposal.ask_price });
            if (res?.error) {
                setStatus('Buy failed: ' + (res.error.message || res.error.code));
                setBuying(false);
                return;
            }
            const buy = res.buy;
            clearProposalSub();
            setStatus(`Trade placed (ID ${buy.contract_id}). Monitoring...`);
            monitorContract(String(buy.contract_id));
        } catch (e: any) {
            setStatus('Buy failed: ' + (e?.error?.message || e?.message || 'unknown'));
            setBuying(false);
        }
    };

    if (!is_logged_in) {
        return (
            <div className='apex-manual'>
                <h3>Manual Trade</h3>
                <div className='apex-manual__login'>
                    Log in to your Deriv account to place manual digit trades from your analysis.
                </div>
            </div>
        );
    }

    const range = meta.range || [0, 9];
    const digitButtons: number[] = [];
    for (let digit = range[0]; digit <= range[1]; digit++) digitButtons.push(digit);

    const potentialProfit =
        proposal && proposal.payout != null && proposal.ask_price != null
            ? (Number(proposal.payout) - Number(proposal.ask_price)).toFixed(2)
            : '-';

    return (
        <div className='apex-manual'>
            <h3>Manual Trade - {symbol}</h3>

            <div className='apex-manual__types'>
                {TRADE_TYPES.map(type => (
                    <button
                        key={type.key}
                        className={tradeType === type.key ? 'active' : ''}
                        onClick={() => setTradeType(type.key)}
                    >
                        {type.label}
                    </button>
                ))}
            </div>

            {needsDigit && (
                <>
                    <div
                        style={{
                            fontSize: '0.68rem',
                            letterSpacing: '0.08em',
                            color: 'var(--text-less-prominent)',
                            textTransform: 'uppercase',
                            marginBottom: '6px',
                        }}
                    >
                        {meta.label} digit
                    </div>
                    <div className='apex-manual__digits'>
                        {digitButtons.map(digit => (
                            <button
                                key={digit}
                                className={prediction === digit ? 'active' : ''}
                                onClick={() => setPrediction(digit)}
                            >
                                {digit}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <div className='apex-manual__row'>
                <div className='apex-manual__field'>
                    <label>Stake ({currency})</label>
                    <input
                        type='number'
                        min={0.35}
                        step={0.01}
                        value={stake}
                        onChange={event => setStake(Number(event.target.value))}
                    />
                </div>
                <div className='apex-manual__field'>
                    <label>Duration (ticks)</label>
                    <input
                        type='number'
                        min={1}
                        max={10}
                        step={1}
                        value={duration}
                        onChange={event => setDuration(Math.max(1, Math.min(10, Number(event.target.value))))}
                    />
                </div>
            </div>

            <div className='apex-manual__preview'>
                <div>
                    <div className='k'>Payout</div>
                    <div className='v'>
                        {proposal?.payout != null ? `${Number(proposal.payout).toFixed(2)} ${currency}` : '-'}
                    </div>
                </div>
                <div>
                    <div className='k'>Potential Profit</div>
                    <div className='v'>{potentialProfit !== '-' ? `${potentialProfit} ${currency}` : '-'}</div>
                </div>
            </div>

            {proposalError && <div className='apex-manual__error'>{proposalError}</div>}

            <button
                className='apex-manual__buy'
                disabled={!proposal?.id || buying || !!proposalError}
                onClick={handleBuy}
            >
                {buying ? 'Processing...' : `BUY ${meta.label}${needsDigit ? ' ' + prediction : ''}`}
            </button>

            {status && (
                <div
                    className={`apex-manual__status ${
                        statusKind === 'win'
                            ? 'apex-manual__status--win'
                            : statusKind === 'loss'
                              ? 'apex-manual__status--loss'
                              : ''
                    }`}
                >
                    {status}
                </div>
            )}

            {contract && (
                <div className='apex-manual__monitor'>
                    <div>
                        <div className='k'>ENTRY SPOT</div>
                        <div className='v'>{contract.entry_spot_display_value ?? contract.entry_spot ?? '-'}</div>
                    </div>
                    <div>
                        <div className='k'>CURRENT SPOT</div>
                        <div className='v'>{contract.current_spot_display_value ?? contract.current_spot ?? '-'}</div>
                    </div>
                    <div>
                        <div className='k'>EXIT SPOT</div>
                        <div className='v'>{contract.exit_tick_display_value ?? contract.exit_tick ?? '-'}</div>
                    </div>
                </div>
            )}

            <div className='apex-manual__note'>
                Trades use Deriv's real proposal and purchase engine. Payouts shown are Deriv's, not estimated. You
                choose the trade; synthetic indices are RNG-based, so no outcome is guaranteed.
            </div>
        </div>
    );
});

export default ManualTrade;
