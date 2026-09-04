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
			<a class="glass-button github-project-link" href="https://github.com/j2agent-ai" target="_blank" rel="noopener noreferrer" aria-label="打开 J2Agent AI GitHub 项目">
				<svg class="github-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.3 11.3 0 0 0-3.57 22.02c.57.1.78-.25.78-.55v-2.1c-3.18.7-3.85-1.35-3.85-1.35-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.73-1.54-2.54-.29-5.2-1.27-5.2-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.03 0 0 .96-.31 3.12 1.17a10.8 10.8 0 0 1 5.68 0c2.16-1.48 3.12-1.17 3.12-1.17.62 1.58.23 2.74.11 3.03.73.8 1.18 1.82 1.18 3.07 0 4.4-2.67 5.36-5.22 5.64.41.36.78 1.08.78 2.18v3.23c0 .3.2.66.79.55A11.3 11.3 0 0 0 12 .7Z"/></svg>
				<span>项目地址</span><span aria-hidden="true">↗</span>
			</a>
			<button class="glass-button blue docs-entry" type="button" @click="$emit('open-doc')">
				<svg class="document-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.75h7.1L18 8.2v12.05H6.5zM13.5 3.75V8.2H18M9 12h6M9 15.5h6"/></svg>
				<span>文档中心</span><span aria-hidden="true">↗</span>
			</button>
		</div>
	</header>
</template>
