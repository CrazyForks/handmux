import { describe, expect, it, vi } from 'vitest';
import {
  installHammerheadWebSocketUpgradeCompat,
  patchHammerheadDestinationRequest,
} from '../src/browser/hammerheadCompat.js';

function fakeDestinationRequest(onUpgrade) {
  class DestinationRequest {}
  DestinationRequest.prototype._onUpgrade = onUpgrade;
  return DestinationRequest;
}

describe('Hammerhead WebSocket upgrade compatibility', () => {
  it('loads and patches the pinned Hammerhead destination request implementation', () => {
    expect(installHammerheadWebSocketUpgradeCompat()).toBe(true);
    expect(installHammerheadWebSocketUpgradeCompat()).toBe(false);
  });

  it('exposes the upgrade socket on the response before continuing a successful upgrade', () => {
    const socket = {};
    const head = Buffer.from('head');
    const onUpgrade = vi.fn(function (response, receivedSocket, receivedHead) {
      expect(response.socket).toBe(socket);
      expect(receivedSocket).toBe(socket);
      expect(receivedHead).toBe(head);
      expect(this).toEqual({ request: true });
      return 'upgraded';
    });
    const DestinationRequest = fakeDestinationRequest(onUpgrade);
    const receiver = { request: true };
    const response = {};

    expect(patchHammerheadDestinationRequest(DestinationRequest)).toBe(true);
    expect(DestinationRequest.prototype._onUpgrade.call(receiver, response, socket, head)).toBe('upgraded');
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('preserves an existing response socket', () => {
    const existingSocket = {};
    const upgradeSocket = {};
    const onUpgrade = vi.fn(function (_response, _socket, _head) {});
    const DestinationRequest = fakeDestinationRequest(onUpgrade);
    const response = { socket: existingSocket };

    patchHammerheadDestinationRequest(DestinationRequest);
    DestinationRequest.prototype._onUpgrade(response, upgradeSocket, Buffer.alloc(0));

    expect(response.socket).toBe(existingSocket);
  });

  it('propagates upgrade failures after exposing the socket', () => {
    const failure = new Error('upgrade failed');
    const socket = {};
    const onUpgrade = vi.fn(function (response, _socket, _head) {
      expect(response.socket).toBe(socket);
      throw failure;
    });
    const DestinationRequest = fakeDestinationRequest(onUpgrade);
    const response = {};

    patchHammerheadDestinationRequest(DestinationRequest);

    expect(() => DestinationRequest.prototype._onUpgrade(response, socket, Buffer.alloc(0))).toThrow(failure);
  });
});
