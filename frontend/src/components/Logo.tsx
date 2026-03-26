import { Brain } from 'lucide-react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

const Logo = ({ className = '', size = 'md', showText = true }: LogoProps) => {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  const textSizeClasses = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-3xl',
  };

  const iconSize = sizeClasses[size];
  const textSize = textSizeClasses[size];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative">
        <div className="absolute inset-0 bg-blue-600 rounded-lg blur-sm opacity-50" />
        <div className="relative bg-gradient-to-br from-blue-600 to-blue-700 p-2 rounded-lg">
          <Brain className={`${iconSize} text-white`} />
        </div>
      </div>
      {showText && (
        <span className={`${textSize} font-bold text-gray-900`}>
          Neuro<span className="text-blue-600">Care</span>
        </span>
      )}
    </div>
  );
};

export default Logo;
