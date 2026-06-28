import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import Dropdown from '../src/components/Dropdown.jsx';

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const OPTS = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }];
const render = (props) => act(() => root.render(<Dropdown options={OPTS} {...props} />));
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const trigger = () => container.querySelector('.dd-trigger');
const options = () => [...container.querySelectorAll('.dd-option')];

describe('Dropdown', () => {
  it('shows the selected label and toggles the menu open/closed', () => {
    render({ value: 'a', onChange: vi.fn() });
    expect(trigger().textContent).toContain('Apple');
    expect(options()).toHaveLength(0);
    click(trigger());
    expect(options()).toHaveLength(2);
    click(trigger());
    expect(options()).toHaveLength(0);
  });

  it('selecting an option fires onChange and closes', () => {
    const onChange = vi.fn();
    render({ value: 'a', onChange });
    click(trigger());
    click(options().find((o) => o.textContent === 'Banana'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(options()).toHaveLength(0);
  });

  it('marks the current value as selected', () => {
    render({ value: 'b', onChange: vi.fn() });
    click(trigger());
    const sel = options().find((o) => o.getAttribute('aria-selected') === 'true');
    expect(sel.textContent).toContain('Banana');
  });

  it('closes when a pointerdown lands outside', () => {
    render({ value: 'a', onChange: vi.fn() });
    click(trigger());
    expect(options()).toHaveLength(2);
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(options()).toHaveLength(0);
  });
});
