export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

// Zero-based page index like the hub's `?p=`; anything else is the first page.
export function commitsPageOf(params: URLSearchParams): number {
	const raw = params.get('p');
	return raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0;
}

export interface DayGroup<T> {
	day: string;
	items: T[];
}

export function groupByDay<T extends { date: string }>(
	commits: readonly T[],
	locale: string,
	timeZone?: string
): DayGroup<T>[] {
	const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone });
	const groups: DayGroup<T>[] = [];
	for (const commit of commits) {
		const time = new Date(commit.date);
		const day = Number.isNaN(time.getTime()) ? '' : format.format(time);
		const last = groups.at(-1);
		if (last && last.day === day) last.items.push(commit);
		else groups.push({ day, items: [commit] });
	}
	return groups;
}

// The hub may omit `title`; the first message line stands in, and the body is whatever follows it.
export function splitMessage({ title, message }: { title?: string; message?: string }): {
	title: string;
	body: string;
} {
	const text = message ?? '';
	const head = title ?? text.split('\n', 1)[0];
	const rest = text.startsWith(head) ? text.slice(head.length) : text;
	return { title: head, body: rest.trim() };
}
