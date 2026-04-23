import { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

type GlassCardProps<TElement extends ElementType = 'section'> = {
  as?: TElement;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<TElement>, 'as' | 'className' | 'children'>;

const BASE_CLASSES =
  'card border border-base-content/20 bg-base-100/45 backdrop-blur-md shadow-xl';

function GlassCard<TElement extends ElementType = 'section'>(props: GlassCardProps<TElement>) {
  const { as, className, children, ...restProps } = props;
  const Component = as ?? 'section';

  return (
    <Component
      className={className ? `${BASE_CLASSES} ${className}` : BASE_CLASSES}
      {...restProps}
    >
      {children}
    </Component>
  );
}

export default GlassCard;
