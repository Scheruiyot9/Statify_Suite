import { forwardRef } from 'react';

const Input = forwardRef(function Input(
  { label, error, hint, className = '', leftIcon: LeftIcon, ...props },
  ref
) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700">{label}</label>
      )}
      <div className="relative">
        {LeftIcon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
            <LeftIcon className="h-4 w-4" />
          </span>
        )}
        <input
          ref={ref}
          {...props}
          className={[
            'block w-full rounded-lg border text-sm transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
            'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
            error
              ? 'border-red-400 bg-red-50 focus:ring-red-400'
              : 'border-gray-300 bg-white',
            LeftIcon ? 'pl-9 pr-3 py-2' : 'px-3 py-2',
            className,
          ].join(' ')}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
});

export default Input;
