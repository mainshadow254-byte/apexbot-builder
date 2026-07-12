import { useState } from 'react';
import './bot-settings-modal.scss';

const FIELDS = [
    { key: 'apex_bot_stake', label: 'Trade Amount', helper: 'Base stake for this bot run.', defaultValue: '1' },
    { key: 'apex_bot_multiplier', label: 'Multiplier', helper: 'Martingale multiplier after a loss.', defaultValue: '2' },
    { key: 'apex_bot_stoploss', label: 'Stop Loss', helper: 'Maximum total loss. Use 0 to turn off.', defaultValue: '0' },
    { key: 'apex_bot_takeprofit', label: 'Take Profit', helper: 'Target total profit. Use 0 to turn off.', defaultValue: '0' },
    { key: 'apex_bot_maxstake', label: 'Max Stake', helper: 'Stake cap. Use 0 to turn off.', defaultValue: '0' },
];

type TBotSettingsModalProps = {
    onClose: () => void;
    onSave?: () => void;
    sequential?: boolean;
};

const BotSettingsModal = ({ onClose, onSave, sequential = false }: TBotSettingsModalProps) => {
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
    const [step, setStep] = useState(0);

    const writeValues = () => {
        FIELDS.forEach(field => {
            try {
                localStorage.setItem(field.key, values[field.key] === '' ? field.defaultValue : values[field.key]);
            } catch {
                // Keep the modal usable when storage is unavailable.
            }
        });
    };

    const save = () => {
        writeValues();
        setSaved(true);
        if (onSave) {
            onSave();
            return;
        }
        window.setTimeout(onClose, 700);
    };

    const activeField = FIELDS[step];
    const isLastStep = step === FIELDS.length - 1;

    return (
        <div className='apex-bset__overlay' onClick={onClose}>
            <div className='apex-bset' onClick={event => event.stopPropagation()}>
                <div className='apex-bset__header'>
                    <span>{sequential ? 'ApexDeriv Run Settings' : 'Bot Settings'}</span>
                    <button className='apex-bset__close' onClick={onClose} aria-label='Close'>
                        x
                    </button>
                </div>
                <div className='apex-bset__note'>
                    {sequential
                        ? 'Set each run value before the bot starts. Cancel stops the run.'
                        : 'These values are used every time a bot runs (works on mobile and desktop). Set them once here.'}
                </div>
                {sequential ? (
                    <div className='apex-bset__body apex-bset__body--single'>
                        <div className='apex-bset__step'>
                            Step {step + 1} of {FIELDS.length}
                        </div>
                        <label className='apex-bset__single-row'>
                            <span>{activeField.label}</span>
                            <small>{activeField.helper}</small>
                            <input
                                type='number'
                                inputMode='decimal'
                                value={values[activeField.key]}
                                autoFocus
                                onChange={event =>
                                    setValues(current => ({ ...current, [activeField.key]: event.target.value }))
                                }
                            />
                        </label>
                    </div>
                ) : (
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
                )}
                {sequential ? (
                    <div className='apex-bset__actions'>
                        <button className='apex-bset__secondary' onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            className='apex-bset__secondary'
                            onClick={() => setStep(current => Math.max(0, current - 1))}
                            disabled={step === 0}
                        >
                            Back
                        </button>
                        <button
                            className='apex-bset__save apex-bset__save--inline'
                            onClick={() => (isLastStep ? save() : setStep(current => current + 1))}
                        >
                            {isLastStep ? 'Save & Run' : 'Next'}
                        </button>
                    </div>
                ) : (
                    <button className='apex-bset__save' onClick={save}>
                        {saved ? 'Saved' : 'Save Settings'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default BotSettingsModal;
