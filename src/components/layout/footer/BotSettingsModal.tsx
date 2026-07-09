import { useState } from 'react';
import './bot-settings-modal.scss';

const FIELDS = [
    { key: 'apex_bot_stake', label: 'Trade Amount (base stake)', defaultValue: '1' },
    { key: 'apex_bot_multiplier', label: 'Martingale Multiplier', defaultValue: '2' },
    { key: 'apex_bot_stoploss', label: 'Stop Loss (0 = off)', defaultValue: '0' },
    { key: 'apex_bot_takeprofit', label: 'Take Profit (0 = off)', defaultValue: '0' },
    { key: 'apex_bot_maxstake', label: 'Max Stake (0 = off)', defaultValue: '0' },
];

const BotSettingsModal = ({ onClose }: { onClose: () => void }) => {
    const [values, setValues] = useState<Record<string, string>>(() => {
        const initialValues: Record<string, string> = {};
        FIELDS.forEach(field => {
            try {
                initialValues[field.key] = localStorage.getItem(field.key) ?? field.defaultValue;
            } catch {
                initialValues[field.key] = field.defaultValue;
            }
        });
        return initialValues;
    });
    const [saved, setSaved] = useState(false);

    const save = () => {
        FIELDS.forEach(field => {
            try {
                localStorage.setItem(
                    field.key,
                    values[field.key] === '' ? field.defaultValue : values[field.key]
                );
            } catch {
                // Keep the modal usable when storage is unavailable.
            }
        });
        setSaved(true);
        window.setTimeout(onClose, 700);
    };

    return (
        <div className='apex-bset__overlay' onClick={onClose}>
            <div className='apex-bset' onClick={event => event.stopPropagation()}>
                <div className='apex-bset__header'>
                    <span>Bot Settings</span>
                    <button className='apex-bset__close' onClick={onClose} aria-label='Close'>
                        x
                    </button>
                </div>
                <div className='apex-bset__note'>
                    These values are used every time a bot runs (works on mobile and desktop). Set them once here.
                </div>
                <div className='apex-bset__body'>
                    {FIELDS.map(field => (
                        <label key={field.key} className='apex-bset__row'>
                            <span>{field.label}</span>
                            <input
                                type='number'
                                inputMode='decimal'
                                value={values[field.key]}
                                onChange={event =>
                                    setValues(current => ({ ...current, [field.key]: event.target.value }))
                                }
                            />
                        </label>
                    ))}
                </div>
                <button className='apex-bset__save' onClick={save}>
                    {saved ? 'Saved' : 'Save Settings'}
                </button>
            </div>
        </div>
    );
};

export default BotSettingsModal;
