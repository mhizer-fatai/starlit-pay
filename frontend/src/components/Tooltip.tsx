import { useState, type ReactNode } from "react";

type TooltipProps = {
  text: string;
  children: ReactNode;
  disabled?: boolean;
};

function Tooltip({ text, children, disabled }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  function handleMouseMove(event: React.MouseEvent<HTMLSpanElement>) {
    setPosition({ x: event.clientX, y: event.clientY });
  }

  if (disabled) {
    return <>{children}</>;
  }

  return (
    <span
      className="nav-tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onMouseMove={handleMouseMove}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className="nav-tooltip"
          style={{
            left: position.x + 10,
            top: position.y + 10,
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export { Tooltip };
