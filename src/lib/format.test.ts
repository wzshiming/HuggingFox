import { describe, expect, it } from 'vitest';
import { formatBytes, formatCompact, formatDate, formatRelative } from './format.ts';

describe('formatBytes', () => {
	it('uses decimal units with three significant digits like the hub', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(999)).toBe('999 B');
		expect(formatBytes(4770)).toBe('4.77 kB');
		expect(formatBytes(548_000_000)).toBe('548 MB');
		expect(formatBytes(1_340_000_000)).toBe('1.34 GB');
		expect(formatBytes(10_500_000)).toBe('10.5 MB');
		expect(formatBytes(2_000_000_000_000)).toBe('2 TB');
	});
});

describe('formatCompact', () => {
	it('abbreviates counts with k, M and B suffixes', () => {
		expect(formatCompact(0)).toBe('0');
		expect(formatCompact(999)).toBe('999');
		expect(formatCompact(3360)).toBe('3.36k');
		expect(formatCompact(52_500)).toBe('52.5k');
		expect(formatCompact(1_000_000)).toBe('1M');
		expect(formatCompact(1_234_567)).toBe('1.23M');
		expect(formatCompact(2_500_000_000)).toBe('2.5B');
	});
});

describe('dates', () => {
	const now = new Date('2026-09-18T12:00:00Z');

	it('formats relative time in the requested locale', () => {
		expect(formatRelative('2026-09-18T11:59:40Z', 'en', now)).toBe('20 seconds ago');
		expect(formatRelative('2026-09-18T11:30:00Z', 'en', now)).toBe('30 minutes ago');
		expect(formatRelative('2026-09-18T09:00:00Z', 'en', now)).toBe('3 hours ago');
		expect(formatRelative('2026-09-17T04:37:15Z', 'en', now)).toBe('1 day ago');
		expect(formatRelative('2026-07-01T00:00:00Z', 'en', now)).toBe('2 months ago');
		expect(formatRelative('2024-01-01T00:00:00Z', 'en', now)).toBe('2 years ago');
		expect(formatRelative('2026-09-17T04:37:15Z', 'zh-CN', now)).toBe('1天前');
	});

	it('formats absolute dates and tolerates invalid input', () => {
		expect(formatDate('2026-09-17T04:37:15Z', 'en', 'UTC')).toBe('Sep 17, 2026, 4:37 AM');
		expect(formatDate('not a date', 'en', 'UTC')).toBe('');
		expect(formatRelative(undefined, 'en', now)).toBe('');
	});
});
