import { HTMLAttributes, forwardRef } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  accent?: 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'purple';
}

const accentColors = {
  blue: 'border-t-mx-blue',
  cyan: 'border-t-mx-cyan',
  green: 'border-t-mx-green',
  amber: 'border-t-mx-amber',
  red: 'border-t-mx-red',
  purple: 'border-t-mx-purple',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', accent, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`
          bg-mx-card border border-mx-border rounded-lg p-5
          ${accent ? `border-t-2 ${accentColors[accent]}` : ''}
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';
