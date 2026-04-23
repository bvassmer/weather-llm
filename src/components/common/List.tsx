import { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

type ListProps<TElement extends ElementType = 'div'> = {
  as?: TElement;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<TElement>, 'as' | 'className' | 'children'>;

const BASE_CLASSES = 'rounded-md border border-base-content/20 bg-base-100/45 backdrop-blur-md';

function List<TElement extends ElementType = 'div'>(props: ListProps<TElement>) {
  const { as, className, children, ...restProps } = props;
  const Component = as ?? 'div';

  return (
    <Component className={className ? `${BASE_CLASSES} ${className}` : BASE_CLASSES} {...restProps}>
      {children}
    </Component>
  );
}

export default List;
