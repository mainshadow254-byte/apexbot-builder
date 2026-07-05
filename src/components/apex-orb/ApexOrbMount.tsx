import React, { useEffect } from 'react';
import { initApexScanner } from '@/external/apex-scanner/apex-data-bridge';
import { mountApexOrb } from './orb';
import './orb.css';

const ApexOrbMount: React.FC = () => {
    useEffect(() => {
        let cancelled = false;
        (async () => {
            await initApexScanner();
            if (!cancelled) {
                try {
                    mountApexOrb();
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error('[ApexOrb] mount failed:', e);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return null;
};

export default ApexOrbMount;
