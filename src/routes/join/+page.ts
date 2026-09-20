import { redirect } from '@sveltejs/kit';

// Self-service signup is out of scope; the hub's join url lands on token login.
export function load() {
	redirect(307, '/login');
}
