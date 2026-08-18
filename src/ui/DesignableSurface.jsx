import { useDesignStore, useDesignSurface } from '../store/designStore.js';

export default function DesignableSurface({
  as: Component = 'div',
  designId,
  designName,
  style,
  onClick,
  children,
  ...props
}) {
  const designStyle = useDesignSurface(designId);
  const designEnabled = useDesignStore(state => state.enabled);
  const mergedStyle = style || designStyle
    ? { ...(style ?? {}), ...(designStyle ?? {}) }
    : undefined;
  const handleClick = event => {
    if (designEnabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return <Component
    {...props}
    data-design-id={designId}
    data-design-name={designName}
    style={mergedStyle}
    onClick={onClick ? handleClick : undefined}
  >{children}</Component>;
}
