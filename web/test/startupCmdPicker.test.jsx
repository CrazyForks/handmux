import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import StartupCmdPicker from '../src/components/StartupCmdPicker.jsx';

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (props) => act(() => root.render(<StartupCmdPicker {...props} />));
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const trigger = () => container.querySelector('.dd-trigger');
const options = () => [...container.querySelectorAll('.dd-option')];
const optByText = (t) => options().find((o) => o.textContent.includes(t));

describe('StartupCmdPicker', () => {
  it('shows the current preset on the trigger and emits the chosen preset', () => {
    const onChange = vi.fn();
    render({ value: '', onChange });
    expect(trigger().textContent).toContain('空 shell');
    expect(options()).toHaveLength(0);          // 关闭态:无菜单
    click(trigger());                            // 打开
    expect(options().length).toBeGreaterThan(0);
    click(optByText('claude(启动'));             // 选 claude
    expect(onChange).toHaveBeenLastCalledWith('claude');
    expect(options()).toHaveLength(0);           // 选完收起
  });

  it('custom mode reveals a text input and emits the typed command', () => {
    const onChange = vi.fn();
    render({ value: '', onChange });
    click(trigger());
    click(optByText('自定义'));
    const input = container.querySelector('.startup-custom');
    expect(input).not.toBe(null);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'claude "fix it"');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('claude "fix it"');
  });

  it('a non-preset value opens in custom mode pre-filled', () => {
    render({ value: 'npm run dev', onChange: vi.fn() });
    expect(container.querySelector('.startup-custom').value).toBe('npm run dev');
    expect(trigger().textContent).toContain('自定义');
  });
});
