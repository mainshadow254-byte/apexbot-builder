type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TUTORIAL: 3,
    SCANNER: 4,
    TRADING_BOTS: 5,
    HYBRID_BOTS: 6,
    ANALYSIS: 7,
    COPY_TRADING: 8,
    JOURNAL: 9,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-tutorials',
    'id-scanner',
    'id-trading-bots',
    'id-hybrid-bots',
    'id-analysis',
    'id-copy-trading',
    'id-journal',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
