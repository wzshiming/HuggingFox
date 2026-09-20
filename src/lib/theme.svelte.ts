export const THEME_KEY = 'hfx.theme';

export type Theme = 'light' | 'dark' | 'system';
const order: Theme[] = ['light', 'dark', 'system'];

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createTheme({
	storage,
	prefersDark
}: {
	storage: ThemeStorage | null;
	prefersDark: () => boolean;
}) {
	const stored = storage?.getItem(THEME_KEY);
	let value = $state<Theme>(stored === 'light' || stored === 'dark' ? stored : 'system');
	let systemDark = $state(prefersDark());

	function set(next: Theme) {
		value = next;
		if (next === 'system') storage?.removeItem(THEME_KEY);
		else storage?.setItem(THEME_KEY, next);
	}

	return {
		get value() {
			return value;
		},
		get dark() {
			return value === 'system' ? systemDark : value === 'dark';
		},
		set,
		cycle() {
			set(order[(order.indexOf(value) + 1) % order.length]);
		},
		refreshSystem() {
			systemDark = prefersDark();
		}
	};
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export const theme = createTheme({
	storage: typeof localStorage === 'undefined' ? null : localStorage,
	prefersDark: () => media?.matches ?? false
});

media?.addEventListener('change', theme.refreshSystem);
