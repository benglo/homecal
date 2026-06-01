import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import './keyboard.css';

export function VirtualKeyboard() {
  const [visible, setVisible] = useState(false);
  const [shift, setShift] = useState(false);
  const activeInput = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const kbRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const setKbHeight = useCallback((height: number) => {
    document.documentElement.style.setProperty('--kb-height', `${height}px`);
  }, []);

  useEffect(() => {
    if (visible && containerRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const h = containerRef.current?.getBoundingClientRect().height ?? 0;
          setKbHeight(h);
          activeInput.current?.scrollIntoView({ block: 'center' });
        });
      });
    } else {
      setKbHeight(0);
    }
  }, [visible, setKbHeight]);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (
        (el.tagName === 'INPUT' && !['date', 'time', 'checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)) ||
        el.tagName === 'TEXTAREA'
      ) {
        activeInput.current = el as HTMLInputElement | HTMLTextAreaElement;
        kbRef.current?.setInput(activeInput.current.value);
        setVisible(true);
      }
    };

    const onBlur = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest('.simple-keyboard') || related?.closest('[data-kb-toolbar]')) return;
      setTimeout(() => {
        if (!document.activeElement?.closest('.simple-keyboard') &&
            !document.activeElement?.closest('[data-kb-toolbar]') &&
            document.activeElement !== activeInput.current) {
          setVisible(false);
          activeInput.current = null;
        }
      }, 100);
    };

    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, []);

  const dismiss = () => {
    activeInput.current?.blur();
    setVisible(false);
    activeInput.current = null;
  };

  const onChange = (value: string) => {
    if (!activeInput.current) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set ?? Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    nativeSetter?.call(activeInput.current, value);
    activeInput.current.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const onKeyPress = (button: string) => {
    if (button === '{shift}') {
      setShift((s) => !s);
      return;
    }
    if (button === '{lock}') {
      setShift((s) => !s);
      return;
    }
    if (button === '{enter}') {
      dismiss();
      return;
    }
    if (shift) setShift(false);
  };

  if (!visible) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed left-0 right-0 bottom-0"
      style={{ zIndex: 200 }}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
    >
      <div
        data-kb-toolbar
        className="flex items-center justify-end"
        style={{
          background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
          padding: '6px 12px',
        }}
      >
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); dismiss(); }}
          onTouchEnd={(e) => { e.preventDefault(); dismiss(); }}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--r-sm)',
            padding: '10px 28px',
            fontSize: 16,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Done
        </button>
      </div>
      <Keyboard
        keyboardRef={(r: any) => (kbRef.current = r)}
        onChange={onChange}
        onKeyPress={onKeyPress}
        layoutName={shift ? 'shift' : 'default'}
        theme="hg-theme-default wall-keyboard"
        display={{
          '{bksp}': '⌫',
          '{enter}': '↵',
          '{shift}': '⇧',
          '{lock}': '⇪',
          '{space}': ' ',
          '{tab}': '⇥',
        }}
      />
    </div>,
    document.body
  );
}
