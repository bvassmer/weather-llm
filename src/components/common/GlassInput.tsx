import type { InputHTMLAttributes } from 'react';

type GlassInputProps = InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export default function GlassInput({ className, ...props }: GlassInputProps) {
  return (
    <input
      className={`input input-bordered border-base-content/20 bg-base-100/35 backdrop-blur-md${className ? ` ${className}` : ''}`}
      {...props}
    />
  );
}
