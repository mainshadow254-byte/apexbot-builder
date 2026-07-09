import TradeEngine from '../trade';
import getBotInterface from './BotInterface';
import getTicksInterface from './TicksInterface';
import getToolsInterface from './ToolsInterface';

const sleep = (observer, arg = 1) => {
    return new Promise(
        r =>
            // eslint-disable-next-line no-promise-executor-return
            setTimeout(() => {
                r();
                setTimeout(() => observer.emit('CONTINUE'), 0);
            }, arg * 1000),
        () => {}
    );
};

const Interface = $scope => {
    const tradeEngine = new TradeEngine($scope);
    const { observer } = $scope;
    const getInterface = () => {
        return {
            ...getBotInterface(tradeEngine),
            ...getToolsInterface(tradeEngine),
            getTicksInterface: getTicksInterface(tradeEngine),
            watch: (...args) => tradeEngine.watch(...args),
            sleep: (...args) => sleep(observer, ...args),
            alert: (...args) => alert(...args), // eslint-disable-line no-alert
            prompt: (message, ...rest) => {
                const promptStorageKeys = {
                    'Trade Amount': 'apex_bot_stake',
                    'Martingale Multiplier (e.g. 2)': 'apex_bot_multiplier',
                    'Stop Loss (max total loss, 0 = off)': 'apex_bot_stoploss',
                    'Take Profit (target profit, 0 = off)': 'apex_bot_takeprofit',
                    'Max Stake (cap, 0 = off)': 'apex_bot_maxstake',
                };
                const defaults = {
                    apex_bot_stake: '1',
                    apex_bot_multiplier: '2',
                    apex_bot_stoploss: '0',
                    apex_bot_takeprofit: '0',
                    apex_bot_maxstake: '0',
                };

                try {
                    const key = promptStorageKeys[message];
                    if (key) {
                        const stored = localStorage.getItem(key);
                        if (stored !== null && stored !== '') return stored;
                        return defaults[key];
                    }
                } catch (e) {
                    // Use the safe fallback below when storage is unavailable.
                }

                try {
                    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
                        return window.prompt(message, ...rest);
                    }
                } catch (e) {
                    // Mobile webviews may not support native prompts.
                }
                return '';
            },
            console: {
                log(...args) {
                    // eslint-disable-next-line no-console
                    console.log(new Date().toLocaleTimeString(), ...args);
                },
            },
        };
    };
    return { tradeEngine, observer, getInterface };
};

export default Interface;
