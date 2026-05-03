import React from 'react';

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  fullWidth?: boolean;
  className?: string;
  isLoading?: boolean;
};

const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  disabled = false,
  type = 'button',
  variant = 'primary',
  fullWidth = false,
  className = '',
  isLoading = false,
}) => {
  const base = 'font-medium rounded-lg text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 flex items-center justify-center';
  const size = 'py-2.5 px-5';

  const variants: Record<string, string> = {
    primary:   'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
    secondary: 'bg-slate-600 hover:bg-slate-700 text-white focus:ring-slate-500',
    outline:   'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500',
    danger:    'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  };

  const width = fullWidth ? 'w-full' : '';
  const state = disabled || isLoading ? 'opacity-50 cursor-not-allowed' : '';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${base} ${size} ${variants[variant]} ${width} ${state} ${className}`}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Processing...
        </span>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;