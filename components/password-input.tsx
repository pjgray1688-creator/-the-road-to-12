"use client";

import { useRef, useState, type ComponentProps } from "react";

export function PasswordInput(props: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return <span className="password-input">
    <input {...props} ref={input} type={visible ? "text" : "password"} />
    <button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}
      onMouseDown={event => event.preventDefault()}
      onClick={() => { setVisible(value => !value); input.current?.focus({ preventScroll: true }); }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {visible && <path d="m3 3 18 18" />}
      </svg>
    </button>
  </span>;
}
