'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

const variants = {
  primary: 'bg-mx-blue hover:bg-mx-blue/80 text-white',
  success: 'bg-mx-green hover:bg-mx-green/80 text-white',
  danger: 'bg-mx-red hover:bg-mx-red/80 text-white',
  warning: 'bg-mx-amber hover:bg-mx-amber/80 text-black',
  outline: 'bg-transparent border border-mx-border hover:bg-mx-border/30 text-mx-text',
  ghost: 'bg-transparent hover:bg-mx-border/30 text-mx-text-secondary',
} as const;

type Variant = keyof typeof variants;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', disabled, children, ...props }, ref) => {
    const sizeClass = {
      sm: 'px-2 py-1 text-xs',
      md: 'px-3 py-1.5 text-sm',
      lg: 'px-4 py-2 text-base',
    }[size];

    return (
      <button
        ref={ref}
        className={`
          inline-flex items-center justify-center rounded font-medium
          transition-colors duration-150 whitespace-nowrap
          disabled:opacity-50 disabled:cursor-not-allowed
          ${variants[variant]} ${sizeClass} ${className}
        `}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
