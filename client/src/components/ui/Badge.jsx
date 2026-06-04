const variants = {
  green:     'bg-green-100 text-green-700',
  red:       'bg-red-100 text-red-700',
  yellow:    'bg-yellow-100 text-yellow-700',
  blue:      'bg-blue-100 text-blue-700',
  gray:      'bg-gray-100 text-gray-600',
  primary:   'bg-primary-100 text-primary-700',
  secondary: 'bg-secondary-100 text-secondary-800',
};

export default function Badge({ children, variant = 'gray', className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
