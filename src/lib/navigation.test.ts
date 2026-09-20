import { describe, expect, it } from 'vitest';
import { loginPath, safeNext } from './navigation.ts';

describe('safeNext', () => {
	it('keeps local paths with query and hash', () => {
		expect(safeNext('/new')).toBe('/new');
		expect(safeNext('/datasets/u/r/upload/main?x=1#y')).toBe('/datasets/u/r/upload/main?x=1#y');
	});

	it('falls back to the home page for anything that could leave the app', () => {
		for (const bad of [
			null,
			'',
			'//evil.example/x',
			'/\\evil.example',
			'https://evil.example',
			'javascript:alert(1)',
			'new',
			'/login',
			'/login?next=%2Fnew',
			'/new\nSet-Cookie: x'
		]) {
			expect(safeNext(bad)).toBe('/');
		}
	});
});

describe('loginPath', () => {
	it('encodes the return path and omits it for the home page', () => {
		expect(loginPath('/new-dataset')).toBe('/login?next=%2Fnew-dataset');
		expect(loginPath('/u/r/upload/main?dir=a b')).toBe(
			'/login?next=%2Fu%2Fr%2Fupload%2Fmain%3Fdir%3Da%20b'
		);
		expect(loginPath('/')).toBe('/login');
	});

	it('flags a re-authentication so the form shows although a user is signed in', () => {
		expect(loginPath('/new', true)).toBe('/login?next=%2Fnew&reauth=1');
		expect(loginPath('/', true)).toBe('/login?reauth=1');
	});
});
