import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

export function VirtualKeyboard() {
  const [visible, setVisible] = useState(false);
  const [shift, setShift] = useState(false);
  const activeInput = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const kbRef = useRef<any>(null);

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
      if (related?.closest('.simple-keyboard')) return;
      setTimeout(() => {
        if (!document.activeElement?.closest('.simple-keyboard') &&
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
    if (button === '{shift}' || button === '{lock}') {
      setShift((s) => !s);
      return;
    }
    if (button === '{enter}') {
      activeInput.current?.blur();
      setVisible(false);
      return;
    }
  };

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed left-0 right-0 bottom-0"
      style={{ zIndex: 200 }}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
    >
      <Keyboard
        keyboardRef={(r: any) => (kbRef.current = r)}
        onChange={onChange}
        onKeyPress={onKeyPress}
        layoutName={shift ? 'shift' : 'default'}
        theme="hg-theme-default hg-layout-default"
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
