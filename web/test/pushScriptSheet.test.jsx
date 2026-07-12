import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PushScriptSheet from '../src/components/PushScriptSheet.jsx';

describe('PushScriptSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<PushScriptSheet open={false} pushKey="k" notifyOn onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the command, this device key, and the reliability note', () => {
    render(<PushScriptSheet open pushKey="DEVKEY1" notifyOn onClose={() => {}} />);
    expect(screen.getByText(/handmux push/)).toBeTruthy();
    expect(screen.getByText(/DEVKEY1/)).toBeTruthy();
    expect(screen.getByText(/FCM|APNs|IM|微信|Telegram/)).toBeTruthy();
  });
  it('shows an enable hint and no key when notifications are off', () => {
    render(<PushScriptSheet open pushKey={null} notifyOn={false} onClose={() => {}} />);
    expect(screen.getByText(/开启|enable/i)).toBeTruthy();
  });
});
