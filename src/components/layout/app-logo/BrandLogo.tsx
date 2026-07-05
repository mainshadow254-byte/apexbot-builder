type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({
    width = 120,
    height = 32,
    fill = 'currentColor',
    className = '',
}: TBrandLogoProps) => {
    const logoSize = Math.min(32, width, height);

    return (
        <div
            className={`app-logo${className ? ` ${className}` : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', color: fill }}
        >
            <img
                src="/apex-logo.svg"
                alt="ApexTraders"
                style={{ width: logoSize, height: logoSize, borderRadius: 8 }}
            />
            <span
                style={{
                    fontWeight: 800,
                    fontSize: '1.15rem',
                    background: 'linear-gradient(90deg, #2fe3c3, #3d8bff, #8b5cf6)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    letterSpacing: '.3px',
                }}
            >
                ApexTraders
            </span>
        </div>
    );
};
