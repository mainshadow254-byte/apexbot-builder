import React from 'react';
import { Localize } from '@deriv-com/translations';

type TPlaceholderPage = {
    title: string;
};

const PlaceholderPage: React.FC<TPlaceholderPage> = ({ title }) => {
    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '60vh',
                textAlign: 'center',
                padding: '2rem',
            }}
        >
            <h2
                style={{
                    fontSize: '2rem',
                    fontWeight: 800,
                    marginBottom: '0.5rem',
                    color: 'var(--text-prominent)',
                }}
            >
                {title}
            </h2>
            <p style={{ color: 'var(--text-less-prominent)', maxWidth: 420 }}>
                <Localize i18n_default_text='Coming soon — this section is being wired up.' />
            </p>
        </div>
    );
};

export default PlaceholderPage;
