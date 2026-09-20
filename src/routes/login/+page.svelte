<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import logo from '$logo/logo.svg';
	import { ApiError } from '$lib/api/client';
	import { auth } from '$lib/auth.svelte';
	import { safeNext } from '$lib/navigation';
	import * as m from '$lib/paraglide/messages.js';

	let token = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);
	const next = $derived(safeNext(page.url.searchParams.get('next')));
	// A write refused the stored token: the form replaces it without signing out first.
	const reauth = $derived(page.url.searchParams.has('reauth'));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const candidate = token.trim();
		if (!candidate) return;
		busy = true;
		error = null;
		try {
			await auth.login(candidate);
			token = '';
			goto(next);
		} catch (err) {
			if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
				error = m.login_invalid();
			} else if (err instanceof ApiError) {
				error = m.login_failed({ status: String(err.status), detail: err.detail });
			} else {
				error = m.login_failed({ status: '–', detail: String((err as Error)?.message ?? err) });
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{m.login_title()} – HuggingFox</title>
</svelte:head>

<div class="container flex justify-center pt-10 pb-24 sm:pt-16">
	<div class="w-full max-w-sm">
		<img src={logo} alt="" class="mx-auto mb-6 w-16" />
		<h1 class="text-center text-3xl font-bold">{m.login_title()}</h1>
		<p class="mt-2 text-center text-gray-500 dark:text-gray-400">{m.login_intro()}</p>
		{#if auth.user && !reauth}
			<p class="mt-8 text-center">
				{m.login_already({ name: auth.user.name })}
				<a href={next} class="ml-1 underline">HuggingFox →</a>
			</p>
		{:else}
			{#if auth.user}
				<p class="mt-8 text-center">{m.login_already({ name: auth.user.name })}</p>
			{/if}
			<form class="mt-8 space-y-4" onsubmit={submit}>
				<label class="block">
					<span class="mb-1.5 block text-sm font-semibold">{m.login_token_label()}</span>
					<input
						type="password"
						name="token"
						class="form-input-alt h-10 w-full px-3 font-mono"
						required
						autocomplete="off"
						spellcheck="false"
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={error ? 'login-error' : undefined}
						bind:value={token}
					/>
				</label>
				{#if error}
					<p id="login-error" role="alert" class="text-sm text-red-600 dark:text-red-400">
						{error}
					</p>
				{/if}
				<button
					type="submit"
					class="h-10 w-full rounded-full bg-gray-900 font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
					disabled={busy || !token.trim()}
					aria-busy={busy}
				>
					{busy ? m.login_pending() : m.login_submit()}
				</button>
			</form>
		{/if}
	</div>
</div>
