// The layout mirrors the Paraglide locale into <html lang>, so formatters need no runtime import.
const documentLocale = () =>
	typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en';

const byteUnits = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
const countUnits = ['', 'k', 'M', 'B', 'T'];

function scale(value: number, units: string[]): [number, string] {
	let i = 0;
	while (value >= 1000 && i < units.length - 1) {
		value /= 1000;
		i++;
	}
	return [value, units[i]];
}

function significant(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(value);
}

export function formatBytes(bytes: number, locale = documentLocale()): string {
	const [value, unit] = scale(bytes, byteUnits);
	return `${significant(value, locale)} ${unit}`;
}

export function formatCompact(count: number, locale = documentLocale()): string {
	const [value, unit] = scale(count, countUnits);
	return significant(value, locale) + unit;
}

const relativeSteps: [Intl.RelativeTimeFormatUnit, number][] = [
	['second', 60],
	['minute', 60],
	['hour', 24],
	['day', 30],
	['month', 12],
	['year', Infinity]
];

export function formatRelative(
	iso: string | undefined,
	locale = documentLocale(),
	now = new Date()
): string {
	const time = iso ? new Date(iso).getTime() : NaN;
	if (Number.isNaN(time)) return '';
	let elapsed = Math.max(0, (now.getTime() - time) / 1000);
	const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
	for (const [unit, size] of relativeSteps) {
		if (elapsed < size) return format.format(-Math.floor(elapsed), unit);
		elapsed /= size;
	}
	return '';
}

export function formatDate(
	iso: string | undefined,
	locale = documentLocale(),
	timeZone?: string
): string {
	const date = iso ? new Date(iso) : new Date(NaN);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone
	}).format(date);
}
