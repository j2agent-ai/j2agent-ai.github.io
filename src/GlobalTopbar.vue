<script setup>
defineProps({
	showHomeNav: { type: Boolean, default: true }
})

defineEmits(['open-doc'])
</script>

<template>
	<header class="topbar">
		<a href="/" class="brand" aria-label="返回首页"><img src="/logo-b.svg" alt="J2Agent AI"/></a>
		<nav v-if="showHomeNav">
			<a href="#technology">技术能力</a>
			<a href="#product">产品界面</a>
			<a href="#architecture">平台架构</a>
		</nav>
		<div class="topbar-actions">
			<button class="glass-button blue docs-entry" type="button" @click="$emit('open-doc')">
				<svg class="document-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.75h7.1L18 8.2v12.05H6.5zM13.5 3.75V8.2H18M9 12h6M9 15.5h6"/></svg>
				<span>文档中心</span><span aria-hidden="true">↗</span>
			</button>
		</div>
	</header>
</template>
