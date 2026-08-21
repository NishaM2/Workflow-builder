import { describe, expect, it } from 'vitest';
import { isBlockedIp, assertUrlAllowed, BlockedAddressError } from './ssrf';

describe('isBlockedIp', () => {
    it.each([
        '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1',
        '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fc00::1',
        '::ffff:127.0.0.1',
    ])('blocks %s', (ip) => {
        expect(isBlockedIp(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111'])(
        'allows %s',
        (ip) => {
            expect(isBlockedIp(ip)).toBe(false);
        },
    );
});

describe('assertUrlAllowed', () => {
    it('rejects a literal metadata IP', async () => {
        await expect(
            assertUrlAllowed('http://169.254.169.254/latest/meta-data/'),
        ).rejects.toBeInstanceOf(BlockedAddressError);
    });

    it('rejects non-http protocols', async () => {
        await expect(assertUrlAllowed('file:///etc/passwd')).rejects.toBeInstanceOf(
            BlockedAddressError,
        );
    });

    it('honours the allowPrivate escape hatch', async () => {
        await expect(
            assertUrlAllowed('http://127.0.0.1:3000', { allowPrivate: true }),
        ).resolves.toBeUndefined();
    });
});