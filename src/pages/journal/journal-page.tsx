import React from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import Journal from '@/components/journal';
import Transactions from '@/components/transactions';
import { Localize } from '@deriv-com/translations';
import './journal-page.scss';

const JournalPage = observer(() => {
    const [tab, setTab] = React.useState<'transactions' | 'journal'>('transactions');
    return (
        <div className='apex-journal'>
            <div className='apex-journal__intro'>
                <Text as='h2' weight='bold' size='m' color='prominent' lineHeight='xxl'>
                    <Localize i18n_default_text='Journal' />
                </Text>
                <Text as='p' color='prominent' size='xs' lineHeight='l'>
                    <Localize i18n_default_text='Your full trade history and bot activity log.' />
                </Text>
            </div>
            <div className='apex-journal__subtabs'>
                <button className={tab === 'transactions' ? 'active' : ''} onClick={() => setTab('transactions')}>
                    <Localize i18n_default_text='Transactions' />
                </button>
                <button className={tab === 'journal' ? 'active' : ''} onClick={() => setTab('journal')}>
                    <Localize i18n_default_text='Activity Log' />
                </button>
            </div>
            <div className='apex-journal__body'>
                {tab === 'transactions' ? <Transactions is_drawer_open /> : <Journal />}
            </div>
        </div>
    );
});

export default JournalPage;
