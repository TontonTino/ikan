import React, { useEffect, useId, useRef, useState } from 'react';

export type DropdownItem =
  | {
      type?: 'item';
      key: string;
      label: React.ReactNode;
      icon?: React.ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { type: 'separator'; key: string };

export interface DropdownProps {
  /**
   * Rend le déclencheur. Les props fournies (aria-*, onClick, onKeyDown, ref)
   * doivent être posées sur un <button> (ex. <Button {...props}> ou <IconButton {...props}>).
   */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
  }) => React.ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
  /** Libellé accessible du menu. */
  label?: string;
}

/**
 * Menu déroulant (pattern ARIA « menu button ») :
 * ↓/↑ naviguent, Home/End, Entrée/Espace sélectionnent, Échap ferme et rend
 * le focus au déclencheur, clic extérieur ferme.
 */
export default function Dropdown({ trigger, items, align = 'start', label }: DropdownProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndexOnOpen = useRef<'first' | 'last'>('first');

  const enabledIndexes = items
    .map((it, i) => (it.type !== 'separator' && !it.disabled ? i : -1))
    .filter((i) => i >= 0);

  const focusAt = (i: number) => itemRefs.current[i]?.focus();

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const target = focusIndexOnOpen.current === 'first' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1];
    if (target != null) focusAt(target);
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusIndexOnOpen.current = e.key === 'ArrowDown' ? 'first' : 'last';
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const pos = enabledIndexes.indexOf(current);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(enabledIndexes[(pos + 1) % enabledIndexes.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(enabledIndexes[(pos - 1 + enabledIndexes.length) % enabledIndexes.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(enabledIndexes[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(enabledIndexes[enabledIndexes.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="ui-dropdown" ref={rootRef}>
      {trigger({
        ref: triggerRef,
        onClick: () => {
          focusIndexOnOpen.current = 'first';
          setOpen((o) => !o);
        },
        onKeyDown: onTriggerKeyDown,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': id,
      })}
      {open && (
        <div id={id} role="menu" aria-label={label} className={`ui-menu ui-menu--${align}`} onKeyDown={onMenuKeyDown}>
          {items.map((item, i) =>
            item.type === 'separator' ? (
              <div key={item.key} role="separator" className="ui-menu__separator" />
            ) : (
              <button
                key={item.key}
                ref={(el) => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={`ui-menu__item${item.danger ? ' ui-menu__item--danger' : ''}`}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.icon && <span aria-hidden="true" style={{ display: 'inline-flex' }}>{item.icon}</span>}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
