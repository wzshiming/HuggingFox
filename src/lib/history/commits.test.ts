import { describe, expect, it } from 'vitest';
import { commitsPageOf, groupByDay, shortSha, splitMessage } from './commits.ts';

describe('commits', () => {
	it('abbreviates shas and parses the page parameter defensively', () => {
		expect(shortSha('607a30d783dfa663caf39e06633721c8d4cfcd7e')).toBe('607a30d');
		expect(shortSha('abc')).toBe('abc');
		expect(commitsPageOf(new URLSearchParams(''))).toBe(0);
		expect(commitsPageOf(new URLSearchParams('p=3'))).toBe(3);
		expect(commitsPageOf(new URLSearchParams('p=-1'))).toBe(0);
		expect(commitsPageOf(new URLSearchParams('p=x'))).toBe(0);
		expect(commitsPageOf(new URLSearchParams('p=2.5'))).toBe(0);
	});

	it('groups consecutive commits by calendar day in the given zone', () => {
		const commits = [
			{ id: 'c', date: '2024-02-19T10:57:45.000Z' },
			{ id: 'b', date: '2024-02-19T00:30:00.000Z' },
			{ id: 'a', date: '2024-02-18T23:59:00.000Z' }
		];
		const utc = groupByDay(commits, 'en-US', 'UTC');
		expect(utc.map((g) => [g.day, g.items.map((c) => c.id)])).toEqual([
			['Feb 19, 2024', ['c', 'b']],
			['Feb 18, 2024', ['a']]
		]);
		const tokyo = groupByDay(commits, 'en-US', 'Asia/Tokyo');
		expect(tokyo.map((g) => g.items.map((c) => c.id))).toEqual([['c', 'b', 'a']]);
		expect(groupByDay([], 'en-US', 'UTC')).toEqual([]);
	});

	it('separates the title from the body without inventing one', () => {
		expect(
			splitMessage({ title: 'Update README.md', message: 'Update README.md\n\nMore.' })
		).toEqual({
			title: 'Update README.md',
			body: 'More.'
		});
		expect(splitMessage({ message: 'Only a message\nsecond line' })).toEqual({
			title: 'Only a message',
			body: 'second line'
		});
		expect(splitMessage({ title: 'T', message: 'T' })).toEqual({ title: 'T', body: '' });
		expect(splitMessage({})).toEqual({ title: '', body: '' });
	});
});
