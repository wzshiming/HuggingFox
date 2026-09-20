<script lang="ts">
	import logo from '$logo/logo.svg';
	import * as m from '$lib/paraglide/messages.js';

	const columns = $derived([
		{
			title: m.footer_website(),
			links: [
				{ href: '/models', label: m.nav_models() },
				{ href: '/datasets', label: m.nav_datasets() },
				{ href: '/spaces', label: m.nav_spaces() }
			]
		},
		{
			title: m.footer_resources(),
			links: [
				{ href: 'https://huggingface.co/docs/hub', label: m.nav_docs() },
				{ href: 'https://huggingface.co/docs/hub/api', label: m.footer_hub_api() },
				{ href: 'https://github.com/wzshiming/HuggingFox', label: m.footer_source() }
			]
		}
	]);
</script>

<footer class="border-t border-gray-100 dark:border-gray-800">
	<div class="container grid gap-8 pt-12 pb-16 sm:grid-cols-2 md:grid-cols-4 md:pb-24">
		<div class="sm:col-span-2 md:col-span-2">
			<a href="/" class="flex items-center gap-2 text-lg font-bold">
				<img src={logo} alt="" class="w-7" />
				HuggingFox
			</a>
			<p class="mt-2 max-w-xs text-sm text-gray-500">{m.app_tagline()}</p>
		</div>
		{#each columns as column (column.title)}
			<div>
				<div class="mb-4 text-lg font-semibold">{column.title}</div>
				<ul class="space-y-1 text-gray-600 md:space-y-2 dark:text-gray-400">
					{#each column.links as link (link.href)}
						<li>
							<a
								class="hover:underline"
								href={link.href}
								target={link.href.startsWith('http') ? '_blank' : undefined}
								rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
							>
								{link.label}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</footer>
