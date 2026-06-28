import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import MicButton from '../src/components/MicButton.jsx';

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (props) => act(() => root.render(<MicButton onToggle={() => {}} {...props} />));

describe('MicButton', () => {
  it('渲染一个 svg 图标(不是 emoji)', async () => {
    await render({ active: false });
    expect(container.querySelector('.input-mic svg')).not.toBeNull();
  });
  it('active 时带 on 类(绿色态)', async () => {
    await render({ active: true });
    expect(container.querySelector('.input-mic').classList.contains('on')).toBe(true);
  });
  it('点击调用 onToggle', async () => {
    const onToggle = vi.fn();
    await render({ active: false, onToggle });
    act(() => container.querySelector('.input-mic').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it('disabled 时按钮禁用', async () => {
    await render({ active: false, disabled: true });
    expect(container.querySelector('.input-mic').disabled).toBe(true);
  });
});
