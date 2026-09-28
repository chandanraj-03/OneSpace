import QRCode from 'qrcode';
import { api, authApi } from './services/api.js';
import { icons, getFileIcon } from './icons.js';
import {
	formatBytes,
	formatDate,
	formatDateTime,
	formatRelativeTime,
	getProviderMeta,
	PROVIDERS,
} from './formatters.js';
import { renderLandingView } from './views/landingView.js';
import { renderLoginView } from './views/loginView.js';
import { initBackendStatus, checkBackend, updateUI } from './services/backendStatus.js';

// ==========================================================================
// Application State
// ==========================================================================

const state = {
	currentView: 'landing',
	currentPath: '/',
	files: [],
	accounts: (function() {
		try {
			return JSON.parse(localStorage.getItem('onespace-cached-accounts')) || [];
		} catch {
			return [];
		}
	})(),
	selectedFileIds: new Set(),
	lastSelectedFileId: null,
	viewMode: localStorage.getItem('onespace-view-mode') || 'grid',
	sortBy: 'name',
	sortDirection: 'asc',
	filterType: 'all',
	filterProvider: 'all',
	previewList: [],
	previewIndex: -1,
	accountAliases: (function() {
		try {
			return JSON.parse(localStorage.getItem('onespace-account-aliases')) || {};
		} catch {
			return {};
		}
	})(),
	theme: (function() {
		const saved = localStorage.getItem('onespace-theme');
		if (saved) return saved;
		if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
			return 'dark';
		}
		return 'light';
	})(),
	usedSpace: 0,
	totalSpace: 0,
	activeUploads: new Map(),
	globalSearchTerm: '',
	recentSearches: (function() {
		try {
			return JSON.parse(localStorage.getItem('onespace_recent_searches')) || [];
		} catch {
			return [];
		}
	})(),
	inspectorFile: null,
	authUser: (function() {
		try {
			return JSON.parse(localStorage.getItem('onespace-session-user'));
		} catch {
			return null;
		}
	})(),
};

// ==========================================================================
// Account Nicknames / Aliases Helpers (Feature 6)
// ==========================================================================

function getAccountAlias(accountId, fallback = '') {
	if (!accountId) return fallback;
	return state.accountAliases[accountId] || fallback;
}

function setAccountAlias(accountId, nickname) {
	if (!accountId) return;
	if (nickname && nickname.trim()) {
		state.accountAliases[accountId] = nickname.trim();
	} else {
		delete state.accountAliases[accountId];
	}
	try {
		localStorage.setItem('onespace-account-aliases', JSON.stringify(state.accountAliases));
	} catch (e) {
		console.warn('Could not save account alias:', e);
	}
}

function openEditAliasModal(accountId) {
	const acc = state.accounts.find((a) => a.id === accountId);
	if (!acc) return;
	const idInput = document.getElementById('edit-alias-account-id');
	const aliasInput = document.getElementById('input-account-alias');
	if (idInput) idInput.value = accountId;
	if (aliasInput) {
		aliasInput.value = getAccountAlias(accountId, '');
		aliasInput.placeholder = acc.email ? acc.email.split('@')[0] : 'My Cloud Drive';
	}
	openModal('modal-edit-alias');
}

function extractTokenFromUrl() {
	try {
		const searchParams = new URLSearchParams(window.location.search);
		let token = searchParams.get('token');

		if (!token && window.location.hash.includes('token=')) {
			const hashParts = window.location.hash.split('?');
			if (hashParts.length > 1) {
				const hashParams = new URLSearchParams(hashParts[1]);
				token = hashParams.get('token');
			}
		}

		if (token) {
			localStorage.setItem('onespace-session-token', token);
			const cleanHash = window.location.hash.replace(/[?&]token=[^&]+/, '');
			searchParams.delete('token');
			const search = searchParams.toString();
			const newUrl = window.location.pathname + (search ? `?${search}` : '') + (cleanHash || '#home');
			window.history.replaceState({}, document.title, newUrl);
		}
	} catch (e) {
		console.warn('Could not extract token from URL:', e);
	}
}

// ==========================================================================
// Initialization
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
	extractTokenFromUrl();
	initTheme();
	initBackendStatus();

	// Auto-reload workspace once backend transitions from waking to active
	window.addEventListener('backend:active', async (e) => {
		await checkAuthStatus();
		if (isUserLoggedIn()) {
			await refreshAccounts();
			if (state.currentView !== 'landing' && state.currentView !== 'login') {
				renderCurrentView();
			}
		}
	});

	// Manual ping click handlers
	document.getElementById('btn-wake-ping-now')?.addEventListener('click', () => {
		showToast('Pinging Render backend...', 'info');
		checkBackend(true);
	});
	document.addEventListener('click', (e) => {
		if (e.target.closest('.backend-status-pill')) {
			checkBackend(true);
		}
	});

	await checkAuthStatus();
	initRouting();
	initEventListeners();
	initKeyboardShortcuts();
	initGlobalSearch();
	initUploadHandlers();
	if (isUserLoggedIn()) {
		await refreshAccounts();
	}
});

// ==========================================================================
// Theme Management (System Detection & Dynamic Sync)
// ==========================================================================

function initTheme() {
	document.documentElement.setAttribute('data-theme', state.theme);
	updateThemeIcon();

	// Listen for system theme changes if user hasn't explicitly set a preference
	if (window.matchMedia) {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		mediaQuery.addEventListener('change', (e) => {
			if (!localStorage.getItem('onespace-theme')) {
				state.theme = e.matches ? 'dark' : 'light';
				document.documentElement.setAttribute('data-theme', state.theme);
				updateThemeIcon();
			}
		});
	}
}

function updateThemeIcon() {
	const container = document.getElementById('theme-icon-container');
	if (container) {
		container.innerHTML = state.theme === 'dark' ? icons.sun : icons.moon;
	}
}

function toggleTheme() {
	state.theme = state.theme === 'dark' ? 'light' : 'dark';
	localStorage.setItem('onespace-theme', state.theme);
	document.documentElement.setAttribute('data-theme', state.theme);
	updateThemeIcon();
}

// ==========================================================================
// Routing & Route Guard
// ==========================================================================

const PROTECTED_VIEWS = ['home', 'drive', 'recent', 'starred', 'shared', 'storage', 'quota', 'settings', 'trash'];

export function isUserLoggedIn() {
	return Boolean(state.authUser && state.authUser.email && state.authUser.email !== 'guest@onespace.local');
}

function initRouting() {
	window.addEventListener('hashchange', handleRoute);
	handleRoute();
}

function handleRoute() {
	const hash = window.location.hash || '#landing';
	const [viewPart, queryPart] = hash.slice(1).split('?');
	const targetView = viewPart || 'landing';

	// Enforce Route Guard: Unauthenticated users CANNOT access protected workspace views
	if (PROTECTED_VIEWS.includes(targetView) && !isUserLoggedIn()) {
		state.currentView = 'login';
		window.location.hash = '#login';
		showToast('Please sign in with Google to access your OneSpace workspace.', 'info');
		return;
	}

	state.currentView = targetView;

	const appRoot = document.getElementById('app');
	if (appRoot) {
		appRoot.classList.toggle('layout-landing', state.currentView === 'landing');
		appRoot.classList.toggle('layout-login', state.currentView === 'login');
	}

	updateAuthHeaderAndSidebar();

	// Extract path if present
	if (queryPart) {
		const params = new URLSearchParams(queryPart);
		if (params.has('path')) {
			state.currentPath = params.get('path') || '/';
		}
	} else if (state.currentView !== 'drive') {
		state.currentPath = '/';
	}

	// Update active sidebar nav
	document.querySelectorAll('.sidebar-nav .nav-item').forEach((item) => {
		const navTarget = item.getAttribute('data-nav');
		item.classList.toggle('active', navTarget === state.currentView);
	});

	// Close mobile menu if open
	document.getElementById('app-sidebar')?.classList.remove('open');

	// Clear selection on route change
	state.selectedFileIds.clear();

	// Check for OAuth status or error params in search or hash
	const searchParams = new URLSearchParams(window.location.search);
	const hashParams = new URLSearchParams(queryPart || '');
	const googleParam = searchParams.get('google') || hashParams.get('google');
	const dropboxParam = searchParams.get('dropbox') || hashParams.get('dropbox');
	const errorParam = searchParams.get('error') || hashParams.get('error');

	if (googleParam === 'connected') {
		showToast('Google Drive successfully connected to your OneSpace pool!', 'success');
		if (isUserLoggedIn()) {
			refreshAccounts();
			api.runSync().then(() => renderCurrentView()).catch(() => {});
		}
		cleanUrlOAuthParams();
	} else if (dropboxParam === 'connected') {
		showToast('Dropbox successfully connected to your OneSpace pool!', 'success');
		if (isUserLoggedIn()) {
			refreshAccounts();
			api.runSync().then(() => renderCurrentView()).catch(() => {});
		}
		cleanUrlOAuthParams();
	} else if (errorParam) {
		showToast(decodeURIComponent(errorParam), 'error');
		cleanUrlOAuthParams();
	}

	// Render view
	renderCurrentView();
	updateUI();
}

function cleanUrlOAuthParams() {
	const currentHash = window.location.hash ? window.location.hash.split('?')[0] : '#storage';
	window.history.replaceState({}, document.title, window.location.pathname + currentHash);
}

function navigateTo(view, path = null) {
	if (path) {
		window.location.hash = `#${view}?path=${encodeURIComponent(path)}`;
	} else {
		window.location.hash = `#${view}`;
	}
}

async function checkAuthStatus() {
	try {
		const authRes = await authApi.me();
		if (authRes?.data?.user) {
			state.authUser = authRes.data.user;
			localStorage.setItem('onespace-session-user', JSON.stringify(state.authUser));
			if (authRes.data.token) {
				localStorage.setItem('onespace-session-token', authRes.data.token);
			}
		} else {
			state.authUser = null;
			localStorage.removeItem('onespace-session-user');
			localStorage.removeItem('onespace-session-token');
			localStorage.removeItem('onespace-cached-accounts');
			state.accounts = [];
		}
	} catch {
		// When backend is starting up or waking up, preserve cached session to avoid false logout
		const cachedUser = localStorage.getItem('onespace-session-user');
		if (cachedUser) {
			try {
				state.authUser = JSON.parse(cachedUser);
			} catch {
				state.authUser = null;
			}
		}
	}
	updateAuthHeaderAndSidebar();
}

function updateAuthHeaderAndSidebar() {
	const sidebarAuthLabel = document.getElementById('sidebar-auth-label');
	const headerAuthBtn = document.getElementById('header-btn-auth');
	if (isUserLoggedIn()) {
		const shortName = state.authUser.email.split('@')[0];
		if (sidebarAuthLabel) sidebarAuthLabel.textContent = `Sign Out (${shortName})`;
		if (headerAuthBtn) {
			headerAuthBtn.title = `Signed in as ${state.authUser.email} (Click to sign out)`;
		}
	} else {
		if (sidebarAuthLabel) sidebarAuthLabel.textContent = 'Sign in with Google';
		if (headerAuthBtn) {
			headerAuthBtn.title = 'Sign in with Google';
		}
	}
}

// ==========================================================================
// Data Fetching & Sync
// ==========================================================================

async function loadInitialData() {
	await checkAuthStatus();
	if (isUserLoggedIn()) {
		await refreshAccounts();
	}
	handleRoute();
}

async function refreshAccounts() {
	try {
		const accountsRes = await api.listAccounts();
		state.accounts = Array.isArray(accountsRes) ? accountsRes : (accountsRes?.data || []);
		localStorage.setItem('onespace-cached-accounts', JSON.stringify(state.accounts));

		let total = 0;
		let used = 0;
		state.accounts.forEach((acc) => {
			total += Number(acc.total_space || 0);
			used += Number(acc.used_space || 0);
		});

		state.totalSpace = total;
		state.usedSpace = used;
		updateStorageWidgets();
		updateSidebarDrivesList();
	} catch (err) {
		console.error('Failed to load accounts:', err);
	}
}

function updateStorageWidgets() {
	const percent = state.totalSpace > 0 ? Math.min(100, Math.round((state.usedSpace / state.totalSpace) * 100)) : 0;
	const usedStr = formatBytes(state.usedSpace);
	const totalStr = formatBytes(state.totalSpace);

	// Header pill
	const headerPill = document.getElementById('header-storage-text');
	if (headerPill) {
		headerPill.textContent = `${usedStr} / ${totalStr}`;
	}

	const headerFill = document.getElementById('header-storage-bar-fill');
	if (headerFill) {
		headerFill.style.width = `${percent}%`;
	}

	// Sidebar widget
	const sidebarPercent = document.getElementById('sidebar-storage-percent');
	const sidebarFill = document.getElementById('sidebar-storage-fill');
	const sidebarSub = document.getElementById('sidebar-storage-sub');

	if (sidebarPercent) sidebarPercent.textContent = `${percent}%`;
	if (sidebarFill) sidebarFill.style.width = `${percent}%`;
	if (sidebarSub) sidebarSub.textContent = `${usedStr} of ${totalStr} used`;
}

function updateSidebarDrivesList() {
	const container = document.getElementById('sidebar-drives-list');
	if (!container) return;

	if (!state.accounts || state.accounts.length === 0) {
		container.innerHTML = `
			<a href="#storage" class="sidebar-no-drives">
				<span>No accounts linked yet</span>
			</a>
		`;
		return;
	}

	container.innerHTML = state.accounts.map((acc) => {
		const meta = getProviderMeta(acc.provider);
		const used = formatBytes(acc.used_space || 0);
		const total = formatBytes(acc.total_space || 0);
		const alias = getAccountAlias(acc.id, acc.email || meta.label);
		return `
			<a href="#storage" class="sidebar-drive-item" title="${meta.label} (${alias} • ${acc.email || 'Connected'}): ${used} of ${total}">
				<img src="${meta.icon}" alt="${meta.label}" class="sidebar-drive-icon" onerror="this.style.display='none'">
				<span class="sidebar-drive-name truncate sidebar-drive-alias">${escapeHtml(alias)}</span>
				<span class="sidebar-drive-quota tabular-nums">${used}</span>
			</a>
		`;
	}).join('');
}

// ==========================================================================
// View Renderers
// ==========================================================================

async function renderCurrentView() {
	const main = document.getElementById('main-content');
	if (!main) return;

	if (state.currentView === 'landing') {
		renderLandingView(main, { state, navigateTo, toggleTheme, showToast });
		window.scrollTo(0, 0);
		return;
	}

	if (state.currentView === 'login') {
		renderLoginView(main, { state, navigateTo, toggleTheme, showToast });
		window.scrollTo(0, 0);
		return;
	}

	main.innerHTML = `<div class="empty-state"><span class="upload-spinner" style="width:28px;height:28px;"></span><p class="empty-sub" style="margin-top:0.75rem;">Loading unified files...</p></div>`;

	try {
		switch (state.currentView) {
			case 'home':
				await renderHomeView(main);
				break;
			case 'drive':
				await renderDriveView(main);
				break;
			case 'recent':
				await renderRecentView(main);
				break;
			case 'starred':
				await renderStarredView(main);
				break;
			case 'shared':
				await renderSharedView(main);
				break;
			case 'storage':
				await renderStorageView(main);
				break;
			default:
				await renderHomeView(main);
				break;
		}
	} catch (err) {
		main.innerHTML = `
			<div class="empty-state">
				<div class="empty-icon text-danger">${icons.trash}</div>
				<h3 class="empty-title">Failed to load content</h3>
				<p class="empty-sub">${err.message || 'Please check your connection and try again.'}</p>
				<button class="btn-primary" onclick="window.location.reload()">Reload</button>
			</div>
		`;
	}
}

// --------------------------------------------------------------------------
// Home View (Command Center & Storage Distribution)
// --------------------------------------------------------------------------

async function renderHomeView(container) {
	const response = await api.listFiles('/');
	const files = Array.isArray(response) ? response : (response?.data || response?.files || []);
	state.files = files;

	const percent = state.totalSpace > 0 ? Math.min(100, Math.round((state.usedSpace / state.totalSpace) * 100)) : 0;
	const recentFiles = files.filter((f) => !f.is_folder).slice(0, 8);
	const folderCount = files.filter((f) => f.is_folder).length;
	const fileCount = files.filter((f) => !f.is_folder).length;

	// Build multi-cloud storage segments
	const segments = [];
	if (state.totalSpace > 0 && state.accounts.length > 0) {
		state.accounts.forEach((acc) => {
			const meta = getProviderMeta(acc.provider);
			const segPct = Math.max(0, ((acc.used_space || 0) / state.totalSpace) * 100);
			if (segPct > 0) {
				segments.push({
					label: meta.label,
					email: acc.email,
					color: meta.color || '#3b82f6',
					width: segPct.toFixed(1),
					usedBytes: acc.used_space,
					totalBytes: acc.total_space,
				});
			}
		});
	}

	container.innerHTML = `
		<div class="view-container">
			<!-- Header -->
			<div class="view-header">
				<div class="view-header-row">
					<div>
						<h1 class="view-title">Storage Overview</h1>
						<p class="view-sub">Unified multi-cloud storage pool across all connected provider accounts</p>
					</div>
					<div class="pool-status-pill ${state.accounts.length > 0 ? '' : 'inactive'}">
						<span class="pool-dot"></span>
						<span>${state.accounts.length > 0 ? `Storage Pool Active • ${state.accounts.length} Drive${state.accounts.length > 1 ? 's' : ''}` : 'No Cloud Drives Connected'}</span>
					</div>
				</div>
			</div>

			<!-- Unified Storage Distribution Card -->
			<div class="overview-hub-card">
				<div class="overview-hub-header">
					<div>
						<span class="section-title">Aggregated Capacity</span>
						<div class="section-sub">Distributed storage mirrored across active cloud drives</div>
					</div>
					<div class="distribution-meta-row">
						<span class="distribution-main-num tabular-nums">${formatBytes(state.usedSpace)}</span>
						<span class="distribution-sub-num tabular-nums">&nbsp;/ ${formatBytes(state.totalSpace)} (${percent}% used)</span>
					</div>
				</div>

				<div class="storage-distribution-bar-wrap">
					<div class="segmented-storage-bar">
						${segments.length > 0 ? segments.map((seg) => `
							<div class="storage-bar-segment" style="width: ${seg.width}%; background-color: ${seg.color};" title="${seg.label}: ${formatBytes(seg.usedBytes)} (${seg.width}%)"></div>
						`).join('') : `
							<div class="storage-bar-segment" style="width: 0%;"></div>
						`}
					</div>

					<div class="storage-legend-grid">
						${state.accounts.length > 0 ? state.accounts.map((acc) => {
							const meta = getProviderMeta(acc.provider);
							return `
								<div class="storage-legend-item">
									<span class="legend-dot" style="background-color: ${meta.color};"></span>
									<span>${meta.label}</span>
									<span class="legend-val tabular-nums">${formatBytes(acc.used_space)} / ${formatBytes(acc.total_space)}</span>
								</div>
							`;
						}).join('') : `
							<div class="storage-legend-item">
								<span class="legend-dot" style="background-color: var(--text-muted);"></span>
								<span>Connect a cloud account to aggregate free storage</span>
							</div>
						`}
					</div>
				</div>
			</div>

			<!-- Quick Metrics Row -->
			<div class="stats-summary-row">
				<div class="stat-metric-card">
					<div class="stat-metric-icon">${icons.cloud}</div>
					<div>
						<div class="stat-metric-val tabular-nums">${state.accounts.length}</div>
						<div class="stat-metric-lbl">Connected Drives</div>
					</div>
				</div>
				<div class="stat-metric-card">
					<div class="stat-metric-icon">${icons.folder}</div>
					<div>
						<div class="stat-metric-val tabular-nums">${folderCount}</div>
						<div class="stat-metric-lbl">Virtual Folders</div>
					</div>
				</div>
				<div class="stat-metric-card">
					<div class="stat-metric-icon">${icons.file}</div>
					<div>
						<div class="stat-metric-val tabular-nums">${fileCount}</div>
						<div class="stat-metric-lbl">Mirrored Files</div>
					</div>
				</div>
			</div>

			<!-- Connected Clouds Quick Strip -->
			<div class="home-clouds-strip">
				<div class="view-header-row">
					<div>
						<h2 class="section-title">Connected Cloud Accounts</h2>
						<p class="section-sub">Active drives supplying your unified pool</p>
					</div>
					<a href="#storage" class="sidebar-add-cloud-link">+ Add Account</a>
				</div>

				${state.accounts.length > 0 ? `
					<div class="home-clouds-grid">
						${state.accounts.map((acc) => {
							const meta = getProviderMeta(acc.provider);
							const used = formatBytes(acc.used_space);
							const total = formatBytes(acc.total_space);
							const displayName = getAccountAlias(acc.id, acc.email || meta.label);
							return `
								<div class="home-cloud-card">
									<div class="home-cloud-info">
										<img src="${meta.icon}" alt="${meta.label}" class="home-cloud-icon" onerror="this.style.display='none'">
										<div class="truncate">
											<div class="home-cloud-name truncate">${escapeHtml(displayName)}</div>
											<div class="home-cloud-meta tabular-nums">${used} / ${total} ${acc.email && displayName !== acc.email ? `• ${escapeHtml(acc.email)}` : ''}</div>
										</div>
									</div>
									<a href="#drive" class="btn-icon-xs" title="Browse files in drive">
										${icons.chevronRight}
									</a>
								</div>
							`;
						}).join('')}
					</div>
				` : `
					<div class="home-connect-promo">
						<div class="home-connect-promo-text">
							<h4>Link your first cloud storage account</h4>
							<p>Connect Google Drive, Dropbox, or MEGA to unlock unified multi-cloud aggregation.</p>
						</div>
						<a href="#storage" class="btn-primary btn-sm">Connect Cloud</a>
					</div>
				`}
			</div>

			<!-- Recent Files Section -->
			<div style="margin-top: 2rem;">
				<div class="view-header-row" style="margin-bottom: 0.85rem;">
					<div>
						<h2 class="section-title">Quick Files</h2>
						<p class="section-sub">Recently synchronized items in your root directory</p>
					</div>
					<a href="#drive" class="sidebar-add-cloud-link">View All Files →</a>
				</div>

				${recentFiles.length ? renderFileGridHtml(recentFiles) : `
					<div class="empty-state">
						<div class="empty-icon">${icons.file}</div>
						<h3 class="empty-title">No files in root directory</h3>
						<p class="empty-sub">Upload files or drag-and-drop anywhere to automatically allocate them across your cloud storage pool.</p>
						<button class="btn-primary" id="btn-empty-upload">Upload File</button>
					</div>
				`}
			</div>
		</div>
	`;

	// Bind Upload button on empty state
	document.getElementById('btn-empty-upload')?.addEventListener('click', () => {
		document.getElementById('file-input-files')?.click();
	});

	bindFileInteractions();
}

function renderProviderFilterPillsHtml(files, activeProvider) {
	const allCount = files.length;
	const gdriveCount = files.filter((f) => {
		const p = (f.provider || '').toLowerCase();
		return p === 'google_drive' || p === 'gdrive';
	}).length;
	const photosCount = files.filter((f) => {
		const p = (f.provider || '').toLowerCase();
		return p === 'google_photos' || p === 'photos';
	}).length;
	const dropboxCount = files.filter((f) => (f.provider || '').toLowerCase() === 'dropbox').length;
	const megaCount = files.filter((f) => (f.provider || '').toLowerCase() === 'mega').length;

	const providers = [
		{ id: 'all', label: 'All Clouds', count: allCount, icon: icons.cloud },
		{ id: 'google_drive', label: 'Google Drive', count: gdriveCount, iconImg: PROVIDERS.google_drive?.icon },
		{ id: 'google_photos', label: 'Google Photos', count: photosCount, icon: icons.fileImage },
		{ id: 'dropbox', label: 'Dropbox', count: dropboxCount, iconImg: PROVIDERS.dropbox?.icon },
		{ id: 'mega', label: 'MEGA', count: megaCount, iconImg: PROVIDERS.mega?.icon },
	];

	return providers
		.filter((p) => p.id === 'all' || p.count > 0 || state.accounts.some(acc => acc.provider?.toLowerCase().includes(p.id.replace('_drive', '').replace('google_', ''))))
		.map((p) => `
			<button type="button" class="filter-pill-provider ${activeProvider === p.id ? 'active' : ''}" data-provider-id="${p.id}">
				${p.iconImg ? `<img src="${p.iconImg}" alt="${p.label}" class="filter-pill-provider-icon">` : (p.icon || '')}
				<span>${p.label}</span>
				<span class="filter-pill-count tabular-nums">${p.count}</span>
			</button>
		`).join('');
}

function renderFilterPillsHtml(files, activeFilter) {
	const total = files.length;
	const foldersCount = files.filter((f) => f.is_folder).length;
	const imagesCount = files.filter((f) => !f.is_folder && /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(f.file_name)).length;
	const docsCount = files.filter((f) => !f.is_folder && /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv)$/i.test(f.file_name)).length;
	const mediaCount = files.filter((f) => !f.is_folder && (
		(f.mime_type || '').startsWith('video/') ||
		(f.mime_type || '').startsWith('audio/') ||
		/\.(mp4|mkv|webm|mov|avi|mp3|wav|ogg|flac|m4a)$/i.test(f.file_name)
	)).length;
	const archivesCount = files.filter((f) => !f.is_folder && /\.(zip|tar|gz|rar|7z|bz2)$/i.test(f.file_name)).length;

	const categories = [
		{ id: 'all', label: 'All Items', count: total },
		{ id: 'folders', label: 'Folders', count: foldersCount },
		{ id: 'images', label: 'Images', count: imagesCount },
		{ id: 'documents', label: 'Documents', count: docsCount },
		{ id: 'media', label: 'Media', count: mediaCount },
		{ id: 'archives', label: 'Archives', count: archivesCount },
	];

	return categories.map((cat) => `
		<button type="button" class="filter-pill ${activeFilter === cat.id ? 'active' : ''}" data-filter-id="${cat.id}">
			<span>${cat.label}</span>
			<span class="filter-pill-count tabular-nums">${cat.count}</span>
		</button>
	`).join('');
}

async function renderDriveView(container) {
	const response = await api.listFiles(state.currentPath);
	state.files = Array.isArray(response) ? response : (response?.data || response?.files || []);

	const crumbs = buildBreadcrumbs(state.currentPath);

	container.innerHTML = `
		<div class="view-container">
			<div class="view-header">
				<h1 class="view-title">My Drive</h1>
				<p class="view-sub">Browse, manage, and upload across your unified cloud directories</p>
			</div>

			<!-- Toolbar -->
			<div class="drive-toolbar">
				<div class="breadcrumbs">
					${crumbs.map((c, i) => `
						<span class="crumb-link ${i === crumbs.length - 1 ? 'active' : ''}" data-crumb-path="${c.path}">
							${i === 0 ? icons.home : ''}
							<span>${c.name}</span>
						</span>
						${i < crumbs.length - 1 ? `<span class="crumb-sep">/</span>` : ''}
					`).join('')}
				</div>

				<div class="toolbar-controls">
					<select id="filter-type-select" class="filter-select">
						<option value="all" ${state.filterType === 'all' ? 'selected' : ''}>All Items</option>
						<option value="folders" ${state.filterType === 'folders' ? 'selected' : ''}>Folders Only</option>
						<option value="images" ${state.filterType === 'images' ? 'selected' : ''}>Images</option>
						<option value="documents" ${state.filterType === 'documents' ? 'selected' : ''}>Documents</option>
						<option value="media" ${state.filterType === 'media' ? 'selected' : ''}>Media</option>
						<option value="archives" ${state.filterType === 'archives' ? 'selected' : ''}>Archives</option>
					</select>

					<select id="sort-by-select" class="filter-select">
						<option value="name" ${state.sortBy === 'name' ? 'selected' : ''}>Name (${state.sortDirection === 'desc' ? 'Z-A' : 'A-Z'})</option>
						<option value="date" ${state.sortBy === 'date' ? 'selected' : ''}>Date Modified (${state.sortDirection === 'desc' ? 'Newest' : 'Oldest'})</option>
						<option value="size" ${state.sortBy === 'size' ? 'selected' : ''}>File Size (${state.sortDirection === 'desc' ? 'Largest' : 'Smallest'})</option>
						<option value="provider" ${state.sortBy === 'provider' ? 'selected' : ''}>Provider</option>
					</select>

					<div class="view-toggle-group">
						<button type="button" id="btn-view-grid" class="btn-toggle ${state.viewMode === 'grid' ? 'active' : ''}" title="Grid View">
							${icons.grid}
						</button>
						<button type="button" id="btn-view-table" class="btn-toggle ${state.viewMode === 'table' ? 'active' : ''}" title="List View">
							${icons.list}
						</button>
					</div>

					<button type="button" id="btn-toolbar-info" class="btn-icon" title="Item Details (Alt I)" aria-label="Item Details">
						${icons.info}
					</button>

					<button type="button" id="btn-toolbar-upload" class="btn-primary btn-sm">
						${icons.upload}
						<span>Upload</span>
					</button>
				</div>
			</div>

			<!-- Cloud Provider Filter Chips (Feature 2) -->
			<div class="filter-provider-pills-row" id="drive-provider-filter-pills">
				${renderProviderFilterPillsHtml(state.files, state.filterProvider)}
			</div>

			<!-- Quick-Filter Pills with Live Item Counts -->
			<div class="filter-pills-row" id="drive-filter-pills">
				${renderFilterPillsHtml(state.files, state.filterType)}
			</div>

			<!-- Dynamic Selection Action Bar -->
			<div id="selection-bar" class="selection-bar hidden">
				<span id="selection-count" class="tabular-nums" style="font-weight: 600;">0 items selected</span>
				<div class="selection-actions">
					<button type="button" id="btn-sel-info" class="btn-selection-act">${icons.info} Details</button>
					<button type="button" id="btn-sel-select-all" class="btn-selection-act">Select All</button>
					<button type="button" id="btn-sel-invert" class="btn-selection-act">Invert</button>
					<button type="button" id="btn-sel-download" class="btn-selection-act">${icons.download} Download</button>
					<button type="button" id="btn-sel-delete" class="btn-selection-act text-danger">${icons.trash} Delete</button>
					<button type="button" id="btn-sel-clear" class="btn-selection-act">${icons.x} Deselect</button>
				</div>
			</div>

			<!-- File Container -->
			<div id="file-display-area">
				${renderFilteredSortedFiles()}
			</div>
		</div>
	`;

	// Bind breadcrumb events
	document.querySelectorAll('[data-crumb-path]').forEach((crumb) => {
		crumb.addEventListener('click', (e) => {
			const path = e.currentTarget.getAttribute('data-crumb-path');
			state.currentPath = path;
			navigateTo('drive', path);
		});
	});

	// Filter pill buttons
	document.querySelectorAll('#drive-filter-pills .filter-pill').forEach((pill) => {
		pill.addEventListener('click', () => {
			const filterId = pill.getAttribute('data-filter-id');
			state.filterType = filterId;
			const sel = document.getElementById('filter-type-select');
			if (sel) sel.value = filterId;
			document.querySelectorAll('#drive-filter-pills .filter-pill').forEach((p) => {
				p.classList.toggle('active', p.getAttribute('data-filter-id') === filterId);
			});
			updateFileDisplayArea();
		});
	});

	document.getElementById('btn-toolbar-info')?.addEventListener('click', () => {
		if (state.selectedFileIds.size > 0) {
			const firstId = Array.from(state.selectedFileIds)[0];
			const file = state.files.find((f) => f.id === firstId);
			if (file) openInspectorDrawer(file);
		} else if (state.files.length > 0) {
			openInspectorDrawer(state.files[0]);
		} else {
			showToast('Select a file to inspect details', 'info');
		}
	});

	document.getElementById('btn-toolbar-upload')?.addEventListener('click', () => {
		document.getElementById('file-input-files')?.click();
	});

	document.getElementById('btn-view-grid')?.addEventListener('click', () => {
		state.viewMode = 'grid';
		localStorage.setItem('onespace-view-mode', 'grid');
		document.getElementById('btn-view-grid').classList.add('active');
		document.getElementById('btn-view-table').classList.remove('active');
		updateFileDisplayArea();
	});

	document.getElementById('btn-view-table')?.addEventListener('click', () => {
		state.viewMode = 'table';
		localStorage.setItem('onespace-view-mode', 'table');
		document.getElementById('btn-view-table').classList.add('active');
		document.getElementById('btn-view-grid').classList.remove('active');
		updateFileDisplayArea();
	});

	document.getElementById('sort-by-select')?.addEventListener('change', (e) => {
		state.sortBy = e.target.value;
		updateFileDisplayArea();
	});

	document.getElementById('filter-type-select')?.addEventListener('change', (e) => {
		state.filterType = e.target.value;
		document.querySelectorAll('#drive-filter-pills .filter-pill').forEach((p) => {
			p.classList.toggle('active', p.getAttribute('data-filter-id') === state.filterType);
		});
		updateFileDisplayArea();
	});

	// Selection Actions
	document.getElementById('btn-sel-info')?.addEventListener('click', () => {
		const firstId = Array.from(state.selectedFileIds)[0];
		const file = state.files.find((f) => f.id === firstId);
		if (file) openInspectorDrawer(file);
	});

	document.getElementById('btn-sel-select-all')?.addEventListener('click', () => {
		state.selectedFileIds.clear();
		state.files.forEach((f) => state.selectedFileIds.add(f.id));
		updateSelectionBar();
		updateSelectionHighlight();
	});

	document.getElementById('btn-sel-invert')?.addEventListener('click', () => {
		const nextSelected = new Set();
		state.files.forEach((f) => {
			if (!state.selectedFileIds.has(f.id)) nextSelected.add(f.id);
		});
		state.selectedFileIds = nextSelected;
		updateSelectionBar();
		updateSelectionHighlight();
	});

	document.getElementById('btn-sel-clear')?.addEventListener('click', () => {
		state.selectedFileIds.clear();
		updateSelectionBar();
		updateFileDisplayArea();
	});

	document.getElementById('btn-sel-delete')?.addEventListener('click', () => {
		openBulkDeleteModal();
	});

	document.getElementById('btn-sel-download')?.addEventListener('click', () => {
		const selected = state.files.filter((f) => state.selectedFileIds.has(f.id) && !f.is_folder);
		selected.forEach((f) => {
			const link = document.createElement('a');
			link.href = api.downloadUrl(f.id);
			link.download = f.file_name;
			document.body.appendChild(link);
			link.click();
			link.remove();
		});
	});

	bindFileInteractions();
}

function updateFileDisplayArea() {
	const area = document.getElementById('file-display-area');
	if (area) {
		area.innerHTML = renderFilteredSortedFiles();
		bindFileInteractions();
	}
	const pillsContainer = document.getElementById('drive-filter-pills');
	if (pillsContainer) {
		pillsContainer.innerHTML = renderFilterPillsHtml(state.files, state.filterType);
		pillsContainer.querySelectorAll('.filter-pill').forEach((pill) => {
			pill.addEventListener('click', () => {
				const filterId = pill.getAttribute('data-filter-id');
				state.filterType = filterId;
				const sel = document.getElementById('filter-type-select');
				if (sel) sel.value = filterId;
				updateFileDisplayArea();
			});
		});
	}
	const providerPillsContainer = document.getElementById('drive-provider-filter-pills');
	if (providerPillsContainer) {
		providerPillsContainer.innerHTML = renderProviderFilterPillsHtml(state.files, state.filterProvider);
		providerPillsContainer.querySelectorAll('.filter-pill-provider').forEach((pill) => {
			pill.addEventListener('click', () => {
				const provId = pill.getAttribute('data-provider-id');
				state.filterProvider = provId;
				updateFileDisplayArea();
			});
		});
	}
}

// --------------------------------------------------------------------------
// Recent, Starred, Shared Views
// --------------------------------------------------------------------------

async function renderRecentView(container) {
	const response = await api.listRecentFiles();
	state.files = Array.isArray(response) ? response : (response?.data || response?.files || []);

	container.innerHTML = `
		<div class="view-container">
			<div class="view-header">
				<h1 class="view-title">Recent Files</h1>
				<p class="view-sub">Recently accessed, uploaded, and synchronized across your clouds</p>
			</div>
			${state.files.length ? renderFileGridHtml(state.files) : `
				<div class="empty-state">
					<div class="empty-icon">${icons.clock}</div>
					<h3 class="empty-title">No recent files</h3>
					<p class="empty-sub">Files you access, edit, or upload will automatically appear here for quick access.</p>
				</div>
			`}
		</div>
	`;
	bindFileInteractions();
}

async function renderStarredView(container) {
	const response = await api.listStarredFiles();
	state.files = Array.isArray(response) ? response : (response?.data || response?.files || []);

	container.innerHTML = `
		<div class="view-container">
			<div class="view-header">
				<h1 class="view-title">Starred Files</h1>
				<p class="view-sub">Your favorite, pinned files and folders across all clouds</p>
			</div>
			${state.files.length ? renderFileGridHtml(state.files) : `
				<div class="empty-state">
					<div class="empty-icon">${icons.star}</div>
					<h3 class="empty-title">No starred files yet</h3>
					<p class="empty-sub">Star any file or folder across your cloud drives to quickly access them in this view.</p>
				</div>
			`}
		</div>
	`;
	bindFileInteractions();
}

async function renderSharedView(container) {
	const response = await api.listSharedWithMeFiles();
	state.files = Array.isArray(response) ? response : (response?.data || response?.files || []);

	container.innerHTML = `
		<div class="view-container">
			<div class="view-header">
				<h1 class="view-title">Shared with Me</h1>
				<p class="view-sub">Items shared with you through your connected cloud accounts</p>
			</div>
			${state.files.length ? renderFileGridHtml(state.files) : `
				<div class="empty-state">
					<div class="empty-icon">${icons.users}</div>
					<h3 class="empty-title">No shared items found</h3>
					<p class="empty-sub">Files and folders shared with your linked accounts will appear here.</p>
				</div>
			`}
		</div>
	`;
	bindFileInteractions();
}

const PROVIDER_COLORS = {
	gdrive: '#4285F4',
	photos: '#FBBC05',
	dropbox: '#0061FE',
	mega: '#D9272E',
	default: '#8b5cf6',
};

function renderStorageSegmentsHtml(accounts, totalSpace) {
	if (!accounts.length || !totalSpace) {
		return `<div class="storage-bar-segment" style="width: 100%; background: var(--border-default);"></div>`;
	}

	return accounts.map((acc) => {
		const pct = Math.max(1, (acc.used_space / totalSpace) * 100);
		const color = PROVIDER_COLORS[acc.provider] || PROVIDER_COLORS.default;
		const meta = getProviderMeta(acc.provider);
		const title = `${meta.label} (${acc.email || ''}): ${formatBytes(acc.used_space)} used`;
		return `<div class="storage-bar-segment" style="width: ${pct}%; background: ${color};" title="${escapeHtml(title)}"></div>`;
	}).join('');
}

function renderStorageLegendHtml(accounts, freeSpace) {
	const items = accounts.map((acc) => {
		const color = PROVIDER_COLORS[acc.provider] || PROVIDER_COLORS.default;
		const meta = getProviderMeta(acc.provider);
		return `
			<div class="storage-legend-item">
				<span class="storage-legend-dot" style="background: ${color};"></span>
				<span><strong>${meta.label}</strong> (${acc.email ? acc.email.split('@')[0] : 'Account'}): <span class="tabular-nums">${formatBytes(acc.used_space)}</span></span>
			</div>
		`;
	});

	items.push(`
		<div class="storage-legend-item">
			<span class="storage-legend-dot" style="background: var(--bg-subtle, #f0f4f9); border: 1px solid var(--border-default);"></span>
			<span><strong>Available Free Pool</strong>: <span class="tabular-nums">${formatBytes(freeSpace)}</span></span>
		</div>
	`);

	return items.join('');
}

async function renderStorageView(container) {
	await refreshAccounts();

	let allocationData = { strategy: 'round_robin', order: [] };
	try {
		allocationData = await api.getAllocation();
	} catch (e) {
		console.warn('Could not load allocation data:', e);
	}

	const freeSpace = Math.max(0, state.totalSpace - state.usedSpace);
	const usedPercent = state.totalSpace > 0 ? Math.round((state.usedSpace / state.totalSpace) * 100) : 0;

	container.innerHTML = `
		<div class="view-container">
			<div class="view-header">
				<h1 class="view-title">Storage & Cloud Accounts</h1>
				<p class="view-sub">Aggregate capacity pool, connected drive credentials, and upload allocation strategy</p>
			</div>

			<!-- Storage Metrics -->
			<div class="stats-summary-row">
				<div class="stat-metric-card">
					<div class="stat-metric-icon">${icons.hardDrive}</div>
					<div>
						<div class="stat-metric-val tabular-nums">${formatBytes(state.totalSpace)}</div>
						<div class="stat-metric-lbl">Total Storage Aggregated</div>
					</div>
				</div>
				<div class="stat-metric-card">
					<div class="stat-metric-icon">${icons.cloud}</div>
					<div>
						<div class="stat-metric-val tabular-nums">${formatBytes(state.usedSpace)}</div>
						<div class="stat-metric-lbl">Storage Used</div>
					</div>
				</div>
				<div class="stat-metric-card">
					<div class="stat-metric-icon" style="color:var(--color-success);">${icons.check}</div>
					<div>
						<div class="stat-metric-val tabular-nums">${formatBytes(freeSpace)}</div>
						<div class="stat-metric-lbl">Available Free Space</div>
					</div>
				</div>
			</div>

			<!-- Multi-Cloud Storage Allocation Visualizer -->
			<div class="storage-visualizer-card">
				<div class="storage-visualizer-header">
					<span class="storage-visualizer-title">Multi-Cloud Storage Allocation</span>
					<span class="storage-visualizer-total tabular-nums">${formatBytes(state.usedSpace)} / ${formatBytes(state.totalSpace)} (${usedPercent}% used)</span>
				</div>
				<div class="storage-segmented-bar">
					${renderStorageSegmentsHtml(state.accounts, state.totalSpace)}
				</div>
				<div class="storage-legend-grid">
					${renderStorageLegendHtml(state.accounts, freeSpace)}
				</div>
			</div>

			<!-- Connected Accounts Section -->
			<div style="margin-top: 2rem;">
				<div class="view-header-row">
					<div>
						<h2 class="section-title">Connected Accounts (${state.accounts.length})</h2>
						<p class="section-sub">Currently linked cloud drives supplying your unified pool</p>
					</div>
				</div>

				<div class="accounts-list">
					${state.accounts.map((acc) => {
						const meta = getProviderMeta(acc.provider);
						const used = formatBytes(acc.used_space);
						const total = formatBytes(acc.total_space);
						const pct = acc.total_space > 0 ? Math.round((acc.used_space / acc.total_space) * 100) : 0;
						const alias = getAccountAlias(acc.id, '');
						const displayName = alias || (acc.email ? acc.email.split('@')[0] : meta.label);
						return `
							<div class="account-card" data-account-id="${acc.id}">
								<div class="account-info">
									<div class="account-icon-wrap">
										<img src="${meta.icon}" alt="${meta.label}" onerror="this.src='/src/assets/logo.webp'">
									</div>
									<div>
										<div class="account-alias-title-row">
											<span class="account-alias-text">${escapeHtml(displayName)}</span>
											<button type="button" class="account-alias-edit-btn" data-action="edit-alias" data-account-id="${acc.id}" title="Set custom nickname">
												${icons.edit} Nickname
											</button>
										</div>
										<div class="account-provider">${acc.email || 'Connected'} • ${meta.label} • <span class="badge-status ${acc.status || 'connected'}">${acc.status || 'Active'}</span></div>
									</div>
								</div>
								<div class="account-storage-meta">
									<div class="tabular-nums"><strong>${used}</strong> of ${total} (${pct}%)</div>
									<button type="button" class="btn-icon-sm btn-disconnect text-danger" data-id="${acc.id}" title="Disconnect account">
										${icons.trash}
									</button>
								</div>
							</div>
						`;
					}).join('')}
					${!state.accounts.length ? `<p class="empty-sub" style="margin-top:0.75rem;">No cloud accounts connected yet. Link an account below to activate your storage pool.</p>` : ''}
				</div>
			</div>

			<!-- Connect Provider Grid -->
			<div style="margin-top: 2.5rem;" id="provider-connect-section">
				<div class="view-header-row">
					<div>
						<h2 class="section-title">Add Cloud Storage</h2>
						<p class="section-sub">Link a provider account via OAuth or direct credentials</p>
					</div>
				</div>

				<div class="provider-connect-grid">
					<div class="provider-connect-card" id="btn-conn-google">
						<div class="provider-card-icon">
							<img src="/src/assets/google-drive.svg" alt="Google Drive">
						</div>
						<div>
							<div class="provider-card-title">Google Drive</div>
							<div class="provider-card-desc">OAuth 2.0 authorization</div>
						</div>
					</div>

					<div class="provider-connect-card" id="btn-conn-dropbox">
						<div class="provider-card-icon">
							<img src="/src/assets/dropbox.svg" alt="Dropbox">
						</div>
						<div>
							<div class="provider-card-title">Dropbox</div>
							<div class="provider-card-desc">Dropbox OAuth connection</div>
						</div>
					</div>

					<div class="provider-connect-card" id="btn-conn-mega">
						<div class="provider-card-icon">
							<img src="/src/assets/mega.svg" alt="MEGA">
						</div>
						<div>
							<div class="provider-card-title">MEGA</div>
							<div class="provider-card-desc">Direct email & password</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Storage Allocation Settings -->
			<div class="settings-box">
				<h2 class="section-title">Smart Upload Allocation</h2>
				<p class="section-sub">When you upload files, OneSpace automatically balances uploads across connected clouds using this policy:</p>

				<div class="strategy-options">
					<label class="strategy-label ${allocationData.strategy === 'round_robin' ? 'active' : ''}">
						<input type="radio" name="alloc-strategy" value="round_robin" ${allocationData.strategy === 'round_robin' ? 'checked' : ''} class="hidden">
						<div class="strategy-title">Round Robin</div>
						<div class="strategy-desc">Distribute uploads evenly across all connected accounts in cyclical rotation.</div>
					</label>
					<label class="strategy-label ${allocationData.strategy === 'most_free' ? 'active' : ''}">
						<input type="radio" name="alloc-strategy" value="most_free" ${allocationData.strategy === 'most_free' ? 'checked' : ''} class="hidden">
						<div class="strategy-title">Most Free Space</div>
						<div class="strategy-desc">Always route uploads to the cloud account that currently has the most free space.</div>
					</label>
					<label class="strategy-label ${allocationData.strategy === 'least_used' ? 'active' : ''}">
						<input type="radio" name="alloc-strategy" value="least_used" ${allocationData.strategy === 'least_used' ? 'checked' : ''} class="hidden">
						<div class="strategy-title">Least Used Space</div>
						<div class="strategy-desc">Prioritize the account with the lowest used storage amount.</div>
					</label>
				</div>

				<button type="button" id="btn-save-allocation" class="btn-primary">Save Strategy</button>
			</div>
		</div>
	`;

	// Bind Edit Alias buttons
	document.querySelectorAll('[data-action="edit-alias"]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const accountId = btn.getAttribute('data-account-id');
			if (accountId) openEditAliasModal(accountId);
		});
	});

	// Bind Provider Connect Cards
	document.getElementById('btn-conn-google')?.addEventListener('click', async () => {
		const btn = document.getElementById('btn-conn-google');
		if (!isUserLoggedIn()) {
			showToast('Please sign in with Google first to link your cloud drive.', 'info');
			navigateTo('login');
			return;
		}
		try {
			if (btn) btn.style.opacity = '0.6';
			const res = await api.getGoogleConnectUrl();
			const url = res?.data?.authorizationUrl || res?.authorizationUrl || res?.url;
			if (url) {
				window.location.href = url;
			} else {
				throw new Error('Google authorization URL not returned by server.');
			}
		} catch (err) {
			if (btn) btn.style.opacity = '';
			showToast(err.message || 'Google Drive not configured in backend/.env', 'error');
		}
	});

	document.getElementById('btn-conn-dropbox')?.addEventListener('click', async () => {
		const btn = document.getElementById('btn-conn-dropbox');
		if (!isUserLoggedIn()) {
			showToast('Please sign in with Google first to link your cloud drive.', 'info');
			navigateTo('login');
			return;
		}
		try {
			if (btn) btn.style.opacity = '0.6';
			const res = await api.getDropboxConnectUrl();
			const url = res?.data?.authorizationUrl || res?.authorizationUrl || res?.url;
			if (url) {
				window.location.href = url;
			} else {
				throw new Error('Dropbox authorization URL not returned by server.');
			}
		} catch (err) {
			if (btn) btn.style.opacity = '';
			showToast(err.message || 'Dropbox not configured in backend/.env', 'error');
		}
	});

	document.getElementById('btn-conn-mega')?.addEventListener('click', () => {
		if (!isUserLoggedIn()) {
			showToast('Please sign in with Google first to link your cloud drive.', 'info');
			navigateTo('login');
			return;
		}
		openModal('modal-connect-mega');
	});

	// Disconnect buttons
	document.querySelectorAll('.btn-disconnect').forEach((btn) => {
		btn.addEventListener('click', async (e) => {
			const id = e.currentTarget.getAttribute('data-id');
			if (confirm('Are you sure you want to disconnect this account?')) {
				try {
					await api.disconnectAccount(id);
					showToast('Account disconnected', 'success');
					await renderStorageView(container);
				} catch (err) {
					showToast(err.message || 'Failed to disconnect', 'error');
				}
			}
		});
	});

	// Strategy selection
	document.querySelectorAll('.strategy-label').forEach((lbl) => {
		lbl.addEventListener('click', () => {
			document.querySelectorAll('.strategy-label').forEach((l) => l.classList.remove('active'));
			lbl.classList.add('active');
			lbl.querySelector('input').checked = true;
		});
	});

	document.getElementById('btn-save-allocation')?.addEventListener('click', async () => {
		const selected = document.querySelector('input[name="alloc-strategy"]:checked')?.value || 'round_robin';
		try {
			await api.updateAllocation({ strategy: selected });
			showToast('Allocation strategy saved', 'success');
		} catch (err) {
			showToast(err.message || 'Failed to save strategy', 'error');
		}
	});
}

// ==========================================================================
// File Filtering, Sorting & Rendering
// ==========================================================================

function renderFilteredSortedFiles() {
	let files = [...state.files];

	// Provider Filter (Feature 2)
	if (state.filterProvider && state.filterProvider !== 'all') {
		files = files.filter((f) => {
			const p = (f.provider || '').toLowerCase();
			if (state.filterProvider === 'google_drive') return p === 'google_drive' || p === 'gdrive';
			if (state.filterProvider === 'google_photos') return p === 'google_photos' || p === 'photos';
			return p === state.filterProvider;
		});
	}

	// Filter
	if (state.filterType === 'folders') {
		files = files.filter((f) => f.is_folder);
	} else if (state.filterType === 'images') {
		files = files.filter((f) => !f.is_folder && /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(f.file_name));
	} else if (state.filterType === 'documents') {
		files = files.filter((f) => !f.is_folder && /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv)$/i.test(f.file_name));
	} else if (state.filterType === 'media') {
		files = files.filter((f) => !f.is_folder && (
			(f.mime_type || '').startsWith('video/') ||
			(f.mime_type || '').startsWith('audio/') ||
			/\.(mp4|mkv|webm|mov|avi|mp3|wav|ogg|flac|m4a)$/i.test(f.file_name)
		));
	} else if (state.filterType === 'archives') {
		files = files.filter((f) => !f.is_folder && /\.(zip|tar|gz|rar|7z|bz2)$/i.test(f.file_name));
	}

	// Sort: Folders first, then sort by criteria and direction (Feature 3)
	const mult = state.sortDirection === 'desc' ? -1 : 1;
	files.sort((a, b) => {
		if (a.is_folder && !b.is_folder) return -1;
		if (!a.is_folder && b.is_folder) return 1;

		if (state.sortBy === 'name') {
			return (a.file_name || '').localeCompare(b.file_name || '') * mult;
		} else if (state.sortBy === 'size') {
			return ((Number(a.size) || 0) - (Number(b.size) || 0)) * mult;
		} else if (state.sortBy === 'date') {
			return (new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)) * mult;
		} else if (state.sortBy === 'provider') {
			return (a.provider || '').localeCompare(b.provider || '') * mult;
		}
		return 0;
	});

	if (!files.length) {
		return `
			<div class="empty-state">
				<div class="empty-icon">${icons.folder}</div>
				<h3 class="empty-title">No matching files</h3>
				<p class="empty-sub">No files found matching the selected cloud provider and file type filters.</p>
			</div>
		`;
	}

	return state.viewMode === 'grid' ? renderFileGridHtml(files) : renderFileTableHtml(files);
}

function renderFileGridHtml(files) {
	return `
		<div class="file-grid">
			${files.map((file) => {
				const isSelected = state.selectedFileIds.has(file.id);
				const icon = getFileIcon(file);
				const size = file.is_folder ? 'Folder' : formatBytes(file.size);
				const providerMeta = getProviderMeta(file.provider);

				const targetFolderPath = file.is_folder
					? ((file.virtual_path || '/').endsWith('/') ? `${file.virtual_path || '/'}${file.file_name}/` : `${file.virtual_path || '/'}/${file.file_name}/`)
					: (file.virtual_path || '/');

				return `
					<div class="file-card ${isSelected ? 'selected' : ''}" data-file-id="${file.id}" data-is-folder="${file.is_folder ? 'true' : 'false'}" data-file-path="${targetFolderPath}">
						<div class="card-top">
							<div class="card-icon">${icon}</div>
							<div class="card-actions">
								<button type="button" class="btn-star ${file.is_starred ? 'starred' : ''}" data-action="star" data-file-id="${file.id}" title="${file.is_starred ? 'Remove Star' : 'Star Item'}">
									${file.is_starred ? icons.starFilled : icons.star}
								</button>
								<button type="button" class="btn-icon-sm" data-action="qr" data-file-id="${file.id}" title="Mobile Download QR">
									${icons.qrCode}
								</button>
								<button type="button" class="btn-icon-sm" data-action="info" data-file-id="${file.id}" title="Details">
									${icons.info}
								</button>
								<button type="button" class="btn-icon-sm" data-action="rename" data-file-id="${file.id}" data-name="${file.file_name}" title="Rename">
									${icons.edit}
								</button>
								<button type="button" class="btn-icon-sm text-danger" data-action="delete" data-file-id="${file.id}" data-name="${file.file_name}" title="Delete">
									${icons.trash}
								</button>
							</div>
						</div>
						<div class="card-name truncate" title="${file.file_name}">${file.file_name}</div>
						<div class="card-footer">
							<span class="tabular-nums">${size}</span>
							<div class="provider-tag">
								${providerMeta.icon ? `<img src="${providerMeta.icon}" alt="${providerMeta.label}" class="provider-mini-icon">` : ''}
								<span class="tabular-nums">${formatRelativeTime(file.updated_at || file.created_at)}</span>
							</div>
						</div>
					</div>
				`;
			}).join('')}
		</div>
	`;
}

function renderFileTableHtml(files) {
	const allSelected = files.length > 0 && files.every((f) => state.selectedFileIds.has(f.id));

	const sortIndicator = (col) => {
		if (state.sortBy !== col) return '';
		return `<span class="sort-indicator">${state.sortDirection === 'desc' ? '▼' : '▲'}</span>`;
	};

	return `
		<div class="file-table-wrap">
			<table class="file-table">
				<thead>
					<tr>
						<th class="table-checkbox-th">
							<input type="checkbox" id="table-select-all" class="file-checkbox" ${allSelected ? 'checked' : ''} aria-label="Select all files">
						</th>
						<th class="sortable-th ${state.sortBy === 'name' ? 'sorted' : ''}" data-sort-col="name" title="Click to sort by name">
							<span>Name</span> ${sortIndicator('name')}
						</th>
						<th class="sortable-th ${state.sortBy === 'provider' ? 'sorted' : ''}" data-sort-col="provider" title="Click to sort by provider">
							<span>Provider</span> ${sortIndicator('provider')}
						</th>
						<th class="sortable-th ${state.sortBy === 'size' ? 'sorted' : ''}" data-sort-col="size" title="Click to sort by file size">
							<span>Size</span> ${sortIndicator('size')}
						</th>
						<th class="sortable-th ${state.sortBy === 'date' ? 'sorted' : ''}" data-sort-col="date" title="Click to sort by modified date">
							<span>Modified</span> ${sortIndicator('date')}
						</th>
						<th style="text-align:right;">Actions</th>
					</tr>
				</thead>
				<tbody>
					${files.map((file) => {
						const isSelected = state.selectedFileIds.has(file.id);
						const icon = getFileIcon(file);
						const size = file.is_folder ? '—' : formatBytes(file.size);
						const providerMeta = getProviderMeta(file.provider);

						const targetFolderPath = file.is_folder
							? ((file.virtual_path || '/').endsWith('/') ? `${file.virtual_path || '/'}${file.file_name}/` : `${file.virtual_path || '/'}/${file.file_name}/`)
							: (file.virtual_path || '/');

						return `
							<tr class="${isSelected ? 'selected' : ''}" data-file-id="${file.id}" data-is-folder="${file.is_folder ? 'true' : 'false'}" data-file-path="${targetFolderPath}">
								<td class="table-checkbox-td">
									<input type="checkbox" class="file-checkbox file-item-checkbox" data-checkbox-id="${file.id}" ${isSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(file.file_name)}">
								</td>
								<td>
									<div class="table-file-cell">
										${icon}
										<span class="truncate" style="max-width:320px;" title="${file.file_name}">${file.file_name}</span>
									</div>
								</td>
								<td>
									<div class="provider-tag">
										${providerMeta.icon ? `<img src="${providerMeta.icon}" alt="${providerMeta.label}" class="provider-mini-icon">` : ''}
										<span>${providerMeta.label}</span>
									</div>
								</td>
								<td class="tabular-nums">${size}</td>
								<td class="tabular-nums">${formatDate(file.updated_at || file.created_at)}</td>
								<td>
									<div class="table-actions-cell">
										<button type="button" class="btn-star ${file.is_starred ? 'starred' : ''}" data-action="star" data-file-id="${file.id}">
											${file.is_starred ? icons.starFilled : icons.star}
										</button>
										${!file.is_folder ? `
											<a href="${api.downloadUrl(file.id)}" download="${file.file_name}" class="btn-icon-sm" title="Download">
												${icons.download}
											</a>
										` : ''}
										<button type="button" class="btn-icon-sm" data-action="info" data-file-id="${file.id}" title="Details">
											${icons.info}
										</button>
										<button type="button" class="btn-icon-sm" data-action="rename" data-file-id="${file.id}" data-name="${file.file_name}" title="Rename">
											${icons.edit}
										</button>
										<button type="button" class="btn-icon-sm text-danger" data-action="delete" data-file-id="${file.id}" data-name="${file.file_name}" title="Delete">
											${icons.trash}
										</button>
									</div>
								</td>
							</tr>
						`;
					}).join('')}
				</tbody>
			</table>
		</div>
	`;
}

// --------------------------------------------------------------------------
// File Interactions (Click, Shift+Click, Context Actions, Right-Click)
// --------------------------------------------------------------------------

let activeContextMenuFile = null;

function showContextMenu(x, y, file) {
	activeContextMenuFile = file;
	const menu = document.getElementById('file-context-menu');
	if (!menu) return;

	const openLabel = document.getElementById('ctx-label-open');
	const openIcon = document.getElementById('ctx-icon-open');
	const previewBtn = menu.querySelector('[data-ctx-action="preview"]');
	const downloadBtn = menu.querySelector('[data-ctx-action="download"]');
	const starLabel = document.getElementById('ctx-label-star');
	const starIcon = document.getElementById('ctx-icon-star');

	if (openLabel && openIcon) {
		if (file.is_folder) {
			openLabel.textContent = 'Open Folder';
			openIcon.innerHTML = icons.folder;
		} else {
			openLabel.textContent = 'Open / Preview';
			openIcon.innerHTML = icons.eye;
		}
	}

	if (previewBtn) previewBtn.style.display = file.is_folder ? 'none' : 'flex';
	if (downloadBtn) downloadBtn.style.display = file.is_folder ? 'none' : 'flex';

	if (starLabel && starIcon) {
		starLabel.textContent = file.is_starred ? 'Remove Star' : 'Add Star';
		starIcon.innerHTML = file.is_starred ? icons.starFilled : icons.star;
	}

	menu.classList.remove('hidden');

	const menuWidth = 220;
	const menuHeight = 280;
	let left = x;
	let top = y;

	if (left + menuWidth > window.innerWidth) {
		left = Math.max(10, window.innerWidth - menuWidth - 10);
	}
	if (top + menuHeight > window.innerHeight) {
		top = Math.max(10, window.innerHeight - menuHeight - 10);
	}

	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
}

function hideContextMenu() {
	const menu = document.getElementById('file-context-menu');
	if (menu) menu.classList.add('hidden');
	activeContextMenuFile = null;
}

function openInspectorDrawer(file) {
	state.inspectorFile = file;
	const drawer = document.getElementById('file-inspector-drawer');
	const content = document.getElementById('inspector-content');
	if (!drawer || !content) return;

	const meta = getProviderMeta(file.provider);
	const icon = getFileIcon(file);
	const size = file.is_folder ? 'Folder' : formatBytes(file.size);
	const exactBytes = file.is_folder ? '' : ` (${Number(file.size || 0).toLocaleString()} bytes)`;
	const fullPath = (file.virtual_path || '/') + file.file_name;

	const accountAlias = getAccountAlias(file.cloud_account_id, '');

	content.innerHTML = `
		<div class="inspector-preview-card">
			<div class="inspector-preview-icon">${icon}</div>
			<h4 class="inspector-file-name" title="${escapeHtml(file.file_name)}">${escapeHtml(file.file_name)}</h4>
			<span class="badge-status ${file.is_folder ? 'folder' : 'file'}">${file.is_folder ? 'Directory' : (file.mime_type || 'File')}</span>
		</div>

		<div class="inspector-meta-list">
			<div class="inspector-meta-row">
				<span class="inspector-meta-label">Cloud Provider</span>
				<div class="inspector-meta-val">
					<div class="provider-tag">
						${meta.icon ? `<img src="${meta.icon}" alt="${meta.label}" class="provider-mini-icon">` : ''}
						<span>${accountAlias ? `${escapeHtml(accountAlias)} (${meta.label})` : meta.label}</span>
					</div>
					<span style="font-size:0.78rem;color:var(--text-muted);">${file.cloud_account_id ? file.cloud_account_id.slice(-6) : ''}</span>
				</div>
			</div>

			<div class="inspector-meta-row">
				<span class="inspector-meta-label">File Size</span>
				<div class="inspector-meta-val tabular-nums">${size}${exactBytes}</div>
			</div>

			<div class="inspector-meta-row">
				<span class="inspector-meta-label">Virtual Location</span>
				<div class="inspector-meta-val">
					<span class="truncate" style="max-width:240px;" title="${escapeHtml(fullPath)}">${escapeHtml(fullPath)}</span>
					<button type="button" class="inspector-copy-btn" id="btn-inspect-copy-path" title="Copy Path">${icons.copy}</button>
				</div>
			</div>

			<div class="inspector-meta-row">
				<span class="inspector-meta-label">Last Modified</span>
				<div class="inspector-meta-val tabular-nums">${formatDateTime(file.updated_at || file.created_at)} (${formatRelativeTime(file.updated_at || file.created_at)})</div>
			</div>

			${file.mime_type ? `
			<div class="inspector-meta-row">
				<span class="inspector-meta-label">MIME Type</span>
				<div class="inspector-meta-val tabular-nums">${file.mime_type}</div>
			</div>
			` : ''}
		</div>

		<div class="inspector-actions-grid">
			${!file.is_folder ? `
				<a href="${api.downloadUrl(file.id)}" download="${file.file_name}" class="btn-primary btn-sm" style="text-align:center;justify-content:center;">
					${icons.download} Download
				</a>
				<button type="button" id="btn-inspect-copy-link" class="btn-secondary btn-sm" style="justify-content:center;">
					${icons.link} Copy Link
				</button>
				<button type="button" id="btn-inspect-qr" class="btn-secondary btn-sm" style="justify-content:center;">
					${icons.qrCode} Mobile QR
				</button>
			` : `
				<button type="button" id="btn-inspect-open-folder" class="btn-primary btn-sm" style="grid-column: span 2;justify-content:center;">
					${icons.folder} Open Folder
				</button>
			`}
			<button type="button" id="btn-inspect-star" class="btn-secondary btn-sm" style="justify-content:center;">
				${file.is_starred ? icons.starFilled : icons.star} ${file.is_starred ? 'Starred' : 'Star'}
			</button>
			<button type="button" id="btn-inspect-delete" class="btn-danger btn-sm" style="justify-content:center;">
				${icons.trash} Delete
			</button>
		</div>
	`;

	document.getElementById('btn-inspect-copy-path')?.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(fullPath);
			showToast('Path copied to clipboard!', 'success');
		} catch {
			showToast('Failed to copy path', 'error');
		}
	});

	document.getElementById('btn-inspect-copy-link')?.addEventListener('click', async () => {
		try {
			const directUrl = `${window.location.origin}${api.downloadUrl(file.id)}`;
			await navigator.clipboard.writeText(directUrl);
			showToast('Direct download link copied!', 'success');
		} catch {
			showToast('Failed to copy link', 'error');
		}
	});

	document.getElementById('btn-inspect-qr')?.addEventListener('click', () => {
		openQrModal(file);
	});

	document.getElementById('btn-inspect-open-folder')?.addEventListener('click', () => {
		const targetPath = (file.virtual_path || '/').endsWith('/')
			? `${file.virtual_path || '/'}${file.file_name}/`
			: `${file.virtual_path || '/'}/${file.file_name}/`;
		state.currentPath = targetPath;
		closeInspectorDrawer();
		navigateTo('drive', targetPath);
	});

	document.getElementById('btn-inspect-star')?.addEventListener('click', async () => {
		try {
			const newStatus = !file.is_starred;
			await api.toggleStar(file.id, newStatus);
			file.is_starred = newStatus;
			updateFileDisplayArea();
			openInspectorDrawer(file);
			showToast(newStatus ? 'Added to starred' : 'Removed from starred', 'success');
		} catch (err) {
			showToast(err.message || 'Failed to update star', 'error');
		}
	});

	document.getElementById('btn-inspect-delete')?.addEventListener('click', () => {
		closeInspectorDrawer();
		openDeleteModal(file.id, file.file_name);
	});

	drawer.classList.remove('hidden');
}

function closeInspectorDrawer() {
	const drawer = document.getElementById('file-inspector-drawer');
	if (drawer) drawer.classList.add('hidden');
	state.inspectorFile = null;
}

function bindFileInteractions() {
	// Master Select All Checkbox
	const masterCheckbox = document.getElementById('table-select-all');
	if (masterCheckbox) {
		const allSelected = state.files.length > 0 && state.files.every((f) => state.selectedFileIds.has(f.id));
		const someSelected = state.files.some((f) => state.selectedFileIds.has(f.id));
		masterCheckbox.checked = allSelected;
		masterCheckbox.indeterminate = !allSelected && someSelected;

		masterCheckbox.addEventListener('change', (e) => {
			if (e.target.checked) {
				state.files.forEach((f) => state.selectedFileIds.add(f.id));
			} else {
				state.selectedFileIds.clear();
			}
			updateSelectionBar();
			updateSelectionHighlight();
		});
	}

	// Individual row checkbox change
	document.querySelectorAll('.file-item-checkbox').forEach((cb) => {
		cb.addEventListener('click', (e) => {
			e.stopPropagation();
		});
		cb.addEventListener('change', (e) => {
			const fileId = cb.getAttribute('data-checkbox-id');
			if (e.target.checked) {
				state.selectedFileIds.add(fileId);
				state.lastSelectedFileId = fileId;
			} else {
				state.selectedFileIds.delete(fileId);
			}
			updateSelectionBar();
			updateSelectionHighlight();
		});
	});

	document.querySelectorAll('[data-file-id]').forEach((el) => {
		const fileId = el.getAttribute('data-file-id');
		const isFolder = el.getAttribute('data-is-folder') === 'true';
		const filePath = el.getAttribute('data-file-path');

		// Click to select / Shift+Click range / Ctrl+Click toggle
		el.addEventListener('click', (e) => {
			if (e.target.closest('[data-action]') || e.target.closest('a') || e.target.closest('.file-checkbox')) return;

			if (e.shiftKey && state.lastSelectedFileId) {
				const allCards = Array.from(document.querySelectorAll('[data-file-id]'));
				const ids = allCards.map((c) => c.getAttribute('data-file-id'));
				const startIdx = ids.indexOf(state.lastSelectedFileId);
				const endIdx = ids.indexOf(fileId);
				if (startIdx !== -1 && endIdx !== -1) {
					const [low, high] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
					for (let i = low; i <= high; i++) {
						state.selectedFileIds.add(ids[i]);
					}
				} else {
					state.selectedFileIds.add(fileId);
				}
			} else if (e.ctrlKey || e.metaKey) {
				if (state.selectedFileIds.has(fileId)) {
					state.selectedFileIds.delete(fileId);
				} else {
					state.selectedFileIds.add(fileId);
					state.lastSelectedFileId = fileId;
				}
			} else {
				state.selectedFileIds.clear();
				state.selectedFileIds.add(fileId);
				state.lastSelectedFileId = fileId;
			}

			updateSelectionBar();
			updateSelectionHighlight();
		});

		// Double-click
		el.addEventListener('dblclick', () => {
			if (isFolder) {
				state.currentPath = filePath;
				navigateTo('drive', filePath);
			} else {
				const file = state.files.find((f) => f.id === fileId);
				if (file) openPreviewModal(file);
			}
		});

		// Right Click Context Menu
		el.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			if (!state.selectedFileIds.has(fileId)) {
				state.selectedFileIds.clear();
				state.selectedFileIds.add(fileId);
				state.lastSelectedFileId = fileId;
				updateSelectionBar();
				updateSelectionHighlight();
			}
			const file = state.files.find((f) => f.id === fileId);
			if (file) {
				showContextMenu(e.clientX, e.clientY, file);
			}
		});
	});

	// Star Buttons
	document.querySelectorAll('[data-action="star"]').forEach((btn) => {
		btn.addEventListener('click', async (e) => {
			e.stopPropagation();
			const fileId = btn.getAttribute('data-file-id');
			const isStarred = btn.classList.contains('starred');
			try {
				await api.toggleStar(fileId, !isStarred);
				btn.classList.toggle('starred', !isStarred);
				btn.innerHTML = !isStarred ? icons.starFilled : icons.star;
				showToast(!isStarred ? 'Added to starred' : 'Removed from starred');
			} catch (err) {
				showToast(err.message || 'Failed to update star', 'error');
			}
		});
	});

	// Info Buttons
	document.querySelectorAll('[data-action="info"]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const fileId = btn.getAttribute('data-file-id');
			const file = state.files.find((f) => f.id === fileId);
			if (file) openInspectorDrawer(file);
		});
	});

	// Rename Buttons
	document.querySelectorAll('[data-action="rename"]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const fileId = btn.getAttribute('data-file-id');
			const name = btn.getAttribute('data-name');
			openRenameModal(fileId, name);
		});
	});

	// Delete Buttons
	document.querySelectorAll('[data-action="delete"]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			const fileId = btn.getAttribute('data-file-id');
			const name = btn.getAttribute('data-name');
			openDeleteModal(fileId, name);
		});
	});
}

function updateSelectionHighlight() {
	document.querySelectorAll('[data-file-id]').forEach((el) => {
		const id = el.getAttribute('data-file-id');
		el.classList.toggle('selected', state.selectedFileIds.has(id));
	});
	document.querySelectorAll('.file-item-checkbox').forEach((cb) => {
		const id = cb.getAttribute('data-checkbox-id');
		cb.checked = state.selectedFileIds.has(id);
	});
	const masterCheckbox = document.getElementById('table-select-all');
	if (masterCheckbox && state.files.length > 0) {
		const allSelected = state.files.every((f) => state.selectedFileIds.has(f.id));
		const someSelected = state.files.some((f) => state.selectedFileIds.has(f.id));
		masterCheckbox.checked = allSelected;
		masterCheckbox.indeterminate = !allSelected && someSelected;
	}
}

function updateSelectionBar() {
	const bar = document.getElementById('selection-bar');
	const count = document.getElementById('selection-count');
	if (!bar || !count) return;

	if (state.selectedFileIds.size > 0) {
		bar.classList.remove('hidden');
		count.textContent = `${state.selectedFileIds.size} item${state.selectedFileIds.size > 1 ? 's' : ''} selected`;
	} else {
		bar.classList.add('hidden');
	}
}

function buildBreadcrumbs(path) {
	const parts = path.split('/').filter(Boolean);
	const crumbs = [{ name: 'My Drive', path: '/' }];
	let accum = '';
	for (const p of parts) {
		accum += '/' + p;
		crumbs.push({ name: p, path: accum });
	}
	return crumbs;
}

// ==========================================================================
// Modals & Action Handlers
// ==========================================================================

function openModal(modalId) {
	const modal = document.getElementById(modalId);
	if (modal) {
		modal.classList.remove('hidden');
		const input = modal.querySelector('input');
		if (input) input.focus();
	}
}

function closeModal(modalId) {
	const modal = document.getElementById(modalId);
	if (modal) {
		modal.classList.add('hidden');
	}
}

function openRenameModal(fileId, currentName) {
	document.getElementById('rename-file-id').value = fileId;
	const input = document.getElementById('input-rename-name');
	input.value = currentName;
	openModal('modal-rename');
}

function openDeleteModal(fileId, name) {
	const btn = document.getElementById('btn-confirm-delete');
	if (btn) {
		btn.disabled = false;
		btn.textContent = 'Delete Item';
		btn.onclick = async () => {
			btn.disabled = true;
			btn.textContent = 'Deleting...';
			try {
				await api.deleteFile(fileId);
				state.files = state.files.filter((f) => f.id !== fileId);
				state.selectedFileIds.delete(fileId);
				if (state.inspectorFile?.id === fileId) {
					closeInspectorDrawer();
				}
				updateSelectionBar();
				closeModal('modal-delete');
				showToast(`Deleted ${name}`, 'success');
				await renderCurrentView();
				refreshAccounts();
			} catch (err) {
				showToast(err.message || 'Failed to delete item', 'error');
			} finally {
				btn.disabled = false;
				btn.textContent = 'Delete Item';
			}
		};
	}
	const msgEl = document.getElementById('delete-modal-msg');
	if (msgEl) {
		msgEl.textContent = `Are you sure you want to delete "${name}"? This action cannot be undone.`;
	}
	openModal('modal-delete');
}

function openBulkDeleteModal() {
	const ids = Array.from(state.selectedFileIds);
	if (!ids.length) return;

	const btn = document.getElementById('btn-confirm-delete');
	if (btn) {
		btn.disabled = false;
		btn.textContent = `Delete ${ids.length} Item${ids.length > 1 ? 's' : ''}`;
		btn.onclick = async () => {
			btn.disabled = true;
			btn.textContent = 'Deleting...';
			try {
				await api.deleteFiles(ids);
				const idSet = new Set(ids);
				state.files = state.files.filter((f) => !idSet.has(f.id));
				state.selectedFileIds.clear();
				if (state.inspectorFile && idSet.has(state.inspectorFile.id)) {
					closeInspectorDrawer();
				}
				updateSelectionBar();
				closeModal('modal-delete');
				showToast(`Deleted ${ids.length} items`, 'success');
				await renderCurrentView();
				refreshAccounts();
			} catch (err) {
				showToast(err.message || 'Failed to delete items', 'error');
			} finally {
				btn.disabled = false;
				btn.textContent = 'Delete Item';
			}
		};
	}
	const msgEl = document.getElementById('delete-modal-msg');
	if (msgEl) {
		msgEl.textContent = `Are you sure you want to delete ${ids.length} selected items?`;
	}
	openModal('modal-delete');
}

function openPreviewModal(file, fileList = null) {
	const nonFolders = (fileList || state.files).filter((f) => !f.is_folder);
	state.previewList = nonFolders;
	state.previewIndex = nonFolders.findIndex((f) => f.id === file.id);
	if (state.previewIndex === -1) {
		state.previewList = [file];
		state.previewIndex = 0;
	}
	renderActivePreviewItem(state.previewList[state.previewIndex]);
	openModal('modal-preview');
}

function navigatePreview(direction) {
	if (!state.previewList || state.previewList.length <= 1) return;
	state.previewIndex = (state.previewIndex + direction + state.previewList.length) % state.previewList.length;
	const file = state.previewList[state.previewIndex];
	if (file) {
		renderActivePreviewItem(file);
	}
}

function renderActivePreviewItem(file) {
	document.getElementById('preview-title').textContent = file.file_name;
	document.getElementById('preview-meta').textContent = `${formatBytes(file.size)} • ${getProviderMeta(file.provider).label}`;
	document.getElementById('preview-download-btn').href = api.downloadUrl(file.id);

	const counter = document.getElementById('preview-counter');
	if (counter) {
		if (state.previewList.length > 1) {
			counter.textContent = `${state.previewIndex + 1} of ${state.previewList.length}`;
			counter.classList.remove('hidden');
		} else {
			counter.classList.add('hidden');
		}
	}

	const hasNav = state.previewList.length > 1;
	const prevNavBtns = [document.getElementById('btn-preview-prev'), document.getElementById('btn-preview-stage-prev')];
	const nextNavBtns = [document.getElementById('btn-preview-next'), document.getElementById('btn-preview-stage-next')];
	prevNavBtns.forEach((b) => { if (b) b.style.display = hasNav ? 'grid' : 'none'; });
	nextNavBtns.forEach((b) => { if (b) b.style.display = hasNav ? 'grid' : 'none'; });

	const body = document.getElementById('preview-body');
	const mime = (file.mime_type || '').toLowerCase();
	const isImage = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(file.file_name);
	const isVideo = mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(file.file_name);
	const isAudio = mime.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/i.test(file.file_name);
	const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(file.file_name);
	const isText = mime.startsWith('text/') || /\.(txt|json|js|ts|html|css|py|md|csv|xml|yaml|yml|sql|sh|go|rs|c|cpp|h)$/i.test(file.file_name);

	if (isImage) {
		body.innerHTML = `<img src="${api.previewUrl(file.id)}" alt="${escapeHtml(file.file_name)}" class="preview-img" onerror="this.src='/src/assets/logo.webp'">`;
	} else if (isVideo) {
		body.innerHTML = `
			<video controls autoplay class="preview-media preview-video">
				<source src="${api.previewUrl(file.id)}" type="${file.mime_type || 'video/mp4'}">
				Your browser does not support HTML5 video preview.
			</video>
		`;
	} else if (isAudio) {
		body.innerHTML = `
			<div class="preview-audio-container">
				<div class="preview-audio-icon-wrap">${icons.fileAudio}</div>
				<div class="preview-audio-title">${escapeHtml(file.file_name)}</div>
				<audio controls autoplay class="preview-audio-player" src="${api.previewUrl(file.id)}">
					Your browser does not support HTML5 audio playback.
				</audio>
			</div>
		`;
	} else if (isPdf) {
		body.innerHTML = `
			<iframe src="${api.previewUrl(file.id)}" class="preview-pdf-frame" title="${escapeHtml(file.file_name)}"></iframe>
		`;
	} else if (isText) {
		body.innerHTML = `<div class="upload-spinner"></div>`;
		fetch(api.previewUrl(file.id))
			.then((r) => r.text())
			.then((text) => {
				body.innerHTML = `<pre class="preview-code">${escapeHtml(text.slice(0, 100000))}</pre>`;
			})
			.catch(() => {
				body.innerHTML = `<p class="empty-sub">Preview not available. Use the download button above.</p>`;
			});
	} else {
		body.innerHTML = `
			<div class="empty-state">
				<div class="empty-icon">${getFileIcon(file)}</div>
				<h3 class="empty-title">${escapeHtml(file.file_name)}</h3>
				<p class="empty-sub">Direct file preview is not supported for this file type. Please use the download option or scan with Mobile QR.</p>
				<div style="display:flex;gap:0.5rem;justify-content:center;margin-top:0.75rem;">
					<a href="${api.downloadUrl(file.id)}" download="${file.file_name}" class="btn-primary btn-sm">
						${icons.download} Download File
					</a>
					<button type="button" class="btn-secondary btn-sm" id="btn-preview-empty-qr">
						${icons.qrCode} Mobile QR
					</button>
				</div>
			</div>
		`;
		document.getElementById('btn-preview-empty-qr')?.addEventListener('click', () => openQrModal(file));
	}
}

async function openQrModal(file) {
	if (!file) return;
	const nameEl = document.getElementById('qr-file-name');
	const sizeEl = document.getElementById('qr-file-size');
	const container = document.getElementById('qr-canvas-container');
	const input = document.getElementById('qr-direct-link-input');

	const directUrl = `${window.location.origin}${api.downloadUrl(file.id)}`;
	if (nameEl) nameEl.textContent = file.file_name;
	if (sizeEl) sizeEl.textContent = `${formatBytes(file.size)} • ${getProviderMeta(file.provider).label}`;
	if (input) input.value = directUrl;

	if (container) {
		container.innerHTML = `<span class="upload-spinner" style="width:28px;height:28px;margin:30px auto;display:block;"></span>`;
		try {
			const svgString = await QRCode.toString(directUrl, {
				type: 'svg',
				margin: 1,
				width: 200,
				color: {
					dark: '#0f172a',
					light: '#ffffff',
				},
			});
			container.innerHTML = svgString;
		} catch (err) {
			console.error('QR code generation failed:', err);
			try {
				const dataUrl = await QRCode.toDataURL(directUrl, { margin: 1, width: 200 });
				container.innerHTML = `<img src="${dataUrl}" alt="QR Code" style="width:200px;height:200px;display:block;">`;
			} catch (canvasErr) {
				container.innerHTML = `<p class="error-msg">Could not generate QR code</p>`;
			}
		}
	}

	openModal('modal-qr-code');
}

function escapeHtml(str) {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==========================================================================
// Upload System (Files, Folders, Drag & Drop, WebSockets)
// ==========================================================================

function initUploadHandlers() {
	const fileInput = document.getElementById('file-input-files');
	const folderInput = document.getElementById('file-input-folder');

	fileInput?.addEventListener('change', (e) => {
		handleFilesUpload(Array.from(e.target.files));
		e.target.value = '';
	});

	folderInput?.addEventListener('change', (e) => {
		handleFilesUpload(Array.from(e.target.files));
		e.target.value = '';
	});

	// Global Fullscreen Drag & Drop Overlay
	let dragDepth = 0;
	const overlay = document.getElementById('drag-drop-overlay');
	const pathEl = document.getElementById('drag-drop-path');

	window.addEventListener('dragenter', (e) => {
		if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
			e.preventDefault();
			dragDepth++;
			if (pathEl) pathEl.textContent = state.currentPath || '/';
			overlay?.classList.remove('hidden');
		}
	});

	window.addEventListener('dragleave', (e) => {
		e.preventDefault();
		dragDepth--;
		if (dragDepth <= 0) {
			dragDepth = 0;
			overlay?.classList.add('hidden');
		}
	});

	window.addEventListener('dragover', (e) => {
		e.preventDefault();
	});

	window.addEventListener('drop', (e) => {
		e.preventDefault();
		dragDepth = 0;
		overlay?.classList.add('hidden');
		if (e.dataTransfer?.files?.length) {
			handleFilesUpload(Array.from(e.dataTransfer.files));
		}
	});
}

async function handleFilesUpload(fileList) {
	if (!fileList.length) return;

	const defaultTitle = 'OneSpace — Unified Multi-Cloud Drive Aggregator';
	showUploadToast();
	const toastStatus = document.getElementById('upload-toast-status');
	const toastBar = document.getElementById('upload-toast-bar');

	let completedCount = 0;
	const totalFiles = fileList.length;
	document.title = `(0%) Uploading 1/${totalFiles} — OneSpace`;

	for (const file of fileList) {
		const relativePath = file.webkitRelativePath || file.name;
		const folderPrefix = relativePath.includes('/') ? '/' + relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
		const targetVirtualPath = state.currentPath === '/' ? (folderPrefix || '/') : (state.currentPath + folderPrefix);

		try {
			if (toastStatus) {
				toastStatus.textContent = `Uploading ${file.name} (${completedCount + 1}/${totalFiles})...`;
			}
			const overallStartPct = Math.round((completedCount / totalFiles) * 100);
			document.title = `(${overallStartPct}%) Uploading ${completedCount + 1}/${totalFiles} — OneSpace`;

			// 1. Initiate upload
			const initiation = await api.initiateUpload({
				file_name: file.name,
				size: file.size,
				file_size: file.size,
				virtual_path: targetVirtualPath,
				mime_type: file.type || 'application/octet-stream',
			});

			const uploadId = initiation?.data?.upload_id || initiation?.upload_id || initiation?.data?.id || initiation?.id;
			if (!uploadId) {
				throw new Error('Upload session ID was not provided by the server');
			}

			// 2. Attach WebSocket progress listener
			try {
				const socket = api.createUploadSocket(uploadId);
				socket.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						if (data.type === 'upload:progress' && toastBar) {
							const fileProgress = data.progress || 0;
							toastBar.style.width = `${fileProgress}%`;
							const overallLivePct = Math.min(99, Math.round(((completedCount + (fileProgress / 100)) / totalFiles) * 100));
							document.title = `(${overallLivePct}%) Uploading ${completedCount + 1}/${totalFiles} — OneSpace`;
						}
					} catch {}
				};
			} catch (wsErr) {
				console.warn('Upload WebSocket listener error:', wsErr);
			}

			// 3. Stream file payload
			await api.uploadFile(uploadId, file);
			completedCount++;
			const donePct = Math.round((completedCount / totalFiles) * 100);
			document.title = `(${donePct}%) Uploaded ${completedCount}/${totalFiles} — OneSpace`;
			showToast(`Uploaded ${file.name}`, 'success');
		} catch (err) {
			showToast(`Failed to upload ${file.name}: ${err.message}`, 'error');
		}
	}

	if (toastStatus) toastStatus.textContent = `Uploaded ${completedCount} of ${totalFiles} files.`;
	if (toastBar) toastBar.style.width = '100%';

	document.title = `✓ Uploads Complete (${completedCount}/${totalFiles}) — OneSpace`;
	setTimeout(() => {
		document.title = defaultTitle;
	}, 4000);

	setTimeout(() => {
		hideUploadToast();
	}, 3500);

	renderCurrentView();
	refreshAccounts();
}

function showUploadToast() {
	document.getElementById('upload-toast')?.classList.remove('hidden');
}
function hideUploadToast() {
	document.getElementById('upload-toast')?.classList.add('hidden');
}

// ==========================================================================
// Global Search
// ==========================================================================

function initGlobalSearch() {
	const input = document.getElementById('global-search-input');
	const clearBtn = document.getElementById('btn-search-clear');
	const dropdown = document.getElementById('search-dropdown');
	const list = document.getElementById('search-results-list');

	let debounceTimeout = null;

	const TOKEN_CHIPS = [
		{ label: 'Google Drive', token: 'provider:gdrive ' },
		{ label: 'Dropbox', token: 'provider:dropbox ' },
		{ label: 'MEGA', token: 'provider:mega ' },
		{ label: 'Google Photos', token: 'provider:photos ' },
		{ label: 'Images', token: 'type:image ' },
		{ label: 'Docs', token: 'type:doc ' },
		{ label: 'Media', token: 'type:media ' },
	];

	function saveRecentSearch(term) {
		const clean = term.trim();
		if (!clean || clean.length < 2) return;
		state.recentSearches = [clean, ...state.recentSearches.filter((s) => s.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
		try {
			localStorage.setItem('onespace_recent_searches', JSON.stringify(state.recentSearches));
		} catch {}
	}

	function renderRecentSearchesDropdown() {
		let html = `
			<div class="search-token-chips">
				${TOKEN_CHIPS.map((tc) => `<span class="search-token-chip" data-search-token="${tc.token}">${tc.label}</span>`).join('')}
			</div>
		`;

		if (state.recentSearches && state.recentSearches.length > 0) {
			html += `
				<div class="search-recent-header">
					<span>Recent Searches</span>
					<button type="button" class="btn-clear-recent" id="btn-clear-recent-searches">Clear</button>
				</div>
				<div class="search-recent-list">
					${state.recentSearches.map((s) => `
						<div class="search-recent-item" data-recent-query="${escapeHtml(s)}">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="icon-svg" style="width:14px;height:14px;color:var(--text-muted);"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
							<span>${escapeHtml(s)}</span>
						</div>
					`).join('')}
				</div>
			`;
		} else {
			html += `<div style="padding:0.75rem 0.85rem;color:var(--text-muted);font-size:0.8rem;">Type search keywords or select a filter tag above</div>`;
		}

		list.innerHTML = html;
		dropdown?.classList.remove('hidden');

		list.querySelectorAll('.search-token-chip').forEach((chip) => {
			chip.addEventListener('click', (e) => {
				e.stopPropagation();
				const token = chip.getAttribute('data-search-token');
				input.value = token;
				input.focus();
				clearBtn?.classList.remove('hidden');
			});
		});

		list.querySelectorAll('.search-recent-item').forEach((item) => {
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				const q = item.getAttribute('data-recent-query');
				input.value = q;
				clearBtn?.classList.remove('hidden');
				executeSearch(q);
			});
		});

		document.getElementById('btn-clear-recent-searches')?.addEventListener('click', (e) => {
			e.stopPropagation();
			state.recentSearches = [];
			localStorage.removeItem('onespace_recent_searches');
			renderRecentSearchesDropdown();
		});
	}

	async function executeSearch(query) {
		const raw = query.trim();
		if (!raw) {
			renderRecentSearchesDropdown();
			return;
		}

		// Parse token filters
		let providerFilter = null;
		let typeFilter = null;
		let cleanQuery = raw;

		const provMatch = raw.match(/provider:(gdrive|dropbox|mega|photos)/i);
		if (provMatch) {
			providerFilter = provMatch[1].toLowerCase();
			cleanQuery = cleanQuery.replace(provMatch[0], '').trim();
		}

		const typeMatch = raw.match(/type:(image|doc|document|media|video|audio|folder)/i);
		if (typeMatch) {
			typeFilter = typeMatch[1].toLowerCase();
			cleanQuery = cleanQuery.replace(typeMatch[0], '').trim();
		}

		try {
			const results = await api.searchFiles(cleanQuery || raw, 30);
			let files = results.data || results.files || [];

			if (providerFilter) {
				files = files.filter((f) => (f.provider || '').toLowerCase().includes(providerFilter));
			}

			if (typeFilter) {
				if (typeFilter === 'folder') {
					files = files.filter((f) => f.is_folder);
				} else if (typeFilter === 'image') {
					files = files.filter((f) => !f.is_folder && /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(f.file_name));
				} else if (typeFilter === 'doc' || typeFilter === 'document') {
					files = files.filter((f) => !f.is_folder && /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv)$/i.test(f.file_name));
				} else if (typeFilter === 'media' || typeFilter === 'video' || typeFilter === 'audio') {
					files = files.filter((f) => !f.is_folder && (
						(f.mime_type || '').startsWith('video/') ||
						(f.mime_type || '').startsWith('audio/') ||
						/\.(mp4|mkv|webm|mov|avi|mp3|wav|ogg|flac|m4a)$/i.test(f.file_name)
					));
				}
			}

			if (!files.length) {
				list.innerHTML = `<div style="padding:1rem;color:var(--text-muted);text-align:center;font-size:0.84rem;">No files found matching "${escapeHtml(raw)}"</div>`;
			} else {
				list.innerHTML = files.map((f) => {
					const itemPath = f.is_folder
						? ((f.virtual_path || '/').endsWith('/') ? `${f.virtual_path || '/'}${f.file_name}/` : `${f.virtual_path || '/'}/${f.file_name}/`)
						: (f.virtual_path || '/');
					return `
					<div class="search-result-item" data-search-id="${f.id}" data-is-folder="${f.is_folder ? 'true' : 'false'}" data-path="${itemPath}">
						<div>${getFileIcon(f)}</div>
						<div class="search-item-info">
							<div class="search-item-title truncate">${escapeHtml(f.file_name)}</div>
							<div class="search-item-path truncate">${escapeHtml(f.virtual_path || '/')}</div>
						</div>
						<div class="search-item-date tabular-nums">${formatDate(f.updated_at || f.created_at)}</div>
					</div>
				`;
				}).join('');

				list.querySelectorAll('.search-result-item').forEach((item) => {
					item.addEventListener('click', () => {
						saveRecentSearch(raw);
						const isFolder = item.getAttribute('data-is-folder') === 'true';
						const path = item.getAttribute('data-path');
						const id = item.getAttribute('data-search-id');

						dropdown.classList.add('hidden');
						input.value = '';
						clearBtn.classList.add('hidden');

						if (isFolder) {
							state.currentPath = path;
							navigateTo('drive', path);
						} else {
							const targetFile = files.find((f) => f.id === id);
							if (targetFile) openPreviewModal(targetFile);
						}
					});
				});
			}
			dropdown?.classList.remove('hidden');
		} catch (err) {
			console.error('Search error:', err);
		}
	}

	// Shortcut listener: Ctrl+K or / to focus search
	window.addEventListener('keydown', (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			input?.focus();
		} else if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
			e.preventDefault();
			input?.focus();
		}
	});

	input?.addEventListener('focus', () => {
		if (!input.value.trim()) {
			renderRecentSearchesDropdown();
		}
	});

	input?.addEventListener('input', (e) => {
		const val = e.target.value;
		clearBtn?.classList.toggle('hidden', !val.trim());

		if (debounceTimeout) clearTimeout(debounceTimeout);

		if (!val.trim()) {
			renderRecentSearchesDropdown();
			return;
		}

		debounceTimeout = setTimeout(() => {
			executeSearch(val);
		}, 200);
	});

	input?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && input.value.trim()) {
			saveRecentSearch(input.value);
		}
	});

	clearBtn?.addEventListener('click', () => {
		input.value = '';
		clearBtn.classList.add('hidden');
		dropdown?.classList.add('hidden');
	});

	// Close search dropdown on click outside
	document.addEventListener('click', (e) => {
		if (!e.target.closest('.search-box')) {
			dropdown?.classList.add('hidden');
		}
	});
}

// ==========================================================================
// General Event Listeners & Modals Binding
// ==========================================================================

function initEventListeners() {
	// Theme Toggle
	document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);

	// Header and Sidebar Auth Sign Out Listener
	const headerAuthBtn = document.getElementById('header-btn-auth');
	headerAuthBtn?.addEventListener('click', async (e) => {
		if (isUserLoggedIn()) {
			e.preventDefault();
			if (window.confirm(`You are currently signed in as:\n${state.authUser.email}\n\nDo you want to sign out?`)) {
				try {
					await authApi.logout();
				} catch {}
				state.authUser = null;
				state.accounts = [];
				localStorage.removeItem('onespace-session-user');
				localStorage.removeItem('onespace-session-token');
				localStorage.removeItem('onespace-cached-accounts');
				showToast('Signed out of OneSpace.', 'info');
				navigateTo('landing');
				updateAuthHeaderAndSidebar();
			}
		}
	});

	const sidebarAuthItem = document.querySelector('.sidebar-nav [data-nav="login"]');
	sidebarAuthItem?.addEventListener('click', async (e) => {
		if (isUserLoggedIn()) {
			e.preventDefault();
			if (window.confirm(`You are currently signed in as:\n${state.authUser.email}\n\nDo you want to sign out?`)) {
				try {
					await authApi.logout();
				} catch {}
				state.authUser = null;
				state.accounts = [];
				localStorage.removeItem('onespace-session-user');
				localStorage.removeItem('onespace-session-token');
				localStorage.removeItem('onespace-cached-accounts');
				showToast('Signed out of OneSpace.', 'info');
				navigateTo('landing');
				updateAuthHeaderAndSidebar();
			}
		}
	});

	// Sync All
	document.getElementById('btn-sync-all')?.addEventListener('click', async () => {
		const btn = document.getElementById('btn-sync-all');
		btn.style.animation = 'spin 0.8s linear infinite';
		try {
			const res = await api.runSync();
			const report = res?.data || res;
			if (report?.accountErrors && Object.keys(report.accountErrors).length > 0) {
				const msgs = Object.entries(report.accountErrors).map(([acc, msg]) => `${acc}: ${msg}`).join('; ');
				showToast(`Sync issue: ${msgs}`, 'warning');
			} else {
				showToast(`Sync complete! ${report?.changesDetected || 0} items indexed.`, 'success');
			}
			await refreshAccounts();
			await renderCurrentView();
		} catch (err) {
			showToast(err.message || 'Sync failed', 'error');
		} finally {
			btn.style.animation = '';
		}
	});

	// Mobile Navigation Toggle
	document.getElementById('btn-mobile-menu')?.addEventListener('click', () => {
		document.getElementById('app-sidebar')?.classList.toggle('open');
	});

	// "+ New" Dropdown
	const newBtn = document.getElementById('btn-new-menu');
	const newDropdown = document.getElementById('new-dropdown');

	newBtn?.addEventListener('click', (e) => {
		e.stopPropagation();
		newDropdown?.classList.toggle('hidden');
	});

	document.addEventListener('click', (e) => {
		if (!e.target.closest('.dropdown-container')) {
			newDropdown?.classList.add('hidden');
		}
	});

	document.getElementById('action-new-folder')?.addEventListener('click', () => {
		newDropdown?.classList.add('hidden');
		openModal('modal-new-folder');
	});

	document.getElementById('action-upload-files')?.addEventListener('click', () => {
		newDropdown?.classList.add('hidden');
		document.getElementById('file-input-files')?.click();
	});

	document.getElementById('action-upload-folder')?.addEventListener('click', () => {
		newDropdown?.classList.add('hidden');
		document.getElementById('file-input-folder')?.click();
	});

	// Action: Link Cloud Storage navigation & scroll-to
	document.addEventListener('click', (e) => {
		const linkTrigger = e.target.closest('.sidebar-add-cloud-link, .sidebar-no-drives, #action-link-storage, .btn-connect-cloud-trigger');
		if (linkTrigger) {
			e.preventDefault();
			newDropdown?.classList.add('hidden');
			if (state.currentView !== 'storage') {
				navigateTo('storage');
			}
			setTimeout(() => {
				const section = document.getElementById('provider-connect-section');
				if (section) {
					section.scrollIntoView({ behavior: 'smooth', block: 'start' });
					section.classList.remove('section-highlight-pulse');
					void section.offsetWidth;
					section.classList.add('section-highlight-pulse');
				}
			}, 80);
		}
	});

	// Close Modals
	document.querySelectorAll('.modal-close').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			const modal = e.target.closest('.modal-backdrop');
			if (modal) modal.classList.add('hidden');
		});
	});

	document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) backdrop.classList.add('hidden');
		});
	});

	window.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
			document.getElementById('search-dropdown')?.classList.add('hidden');
			newDropdown?.classList.add('hidden');
		}
	});

	// New Folder Form
	document.getElementById('form-new-folder')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const name = document.getElementById('input-new-folder-name').value.trim();
		if (!name) return;

		try {
			await api.createFolder({
				name,
				path: state.currentPath,
			});
			closeModal('modal-new-folder');
			document.getElementById('input-new-folder-name').value = '';
			showToast(`Folder "${name}" created`, 'success');
			renderCurrentView();
		} catch (err) {
			showToast(err.message || 'Failed to create folder', 'error');
		}
	});

	// Rename Form
	document.getElementById('form-rename')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const fileId = document.getElementById('rename-file-id').value;
		const newName = document.getElementById('input-rename-name').value.trim();
		if (!newName) return;

		try {
			await api.renameFile(fileId, { name: newName });
			closeModal('modal-rename');
			showToast(`Renamed to "${newName}"`, 'success');
			renderCurrentView();
		} catch (err) {
			showToast(err.message || 'Failed to rename item', 'error');
		}
	});

	// Connect Account Forms (MEGA)
	document.getElementById('form-connect-mega')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const email = document.getElementById('mega-email').value.trim();
		const password = document.getElementById('mega-password').value;
		const errEl = document.getElementById('mega-error');

		errEl?.classList.add('hidden');
		try {
			await api.connectMegaAccount({ email, password });
			closeModal('modal-connect-mega');
			showToast('MEGA account connected successfully', 'success');
			await refreshAccounts();
			renderCurrentView();
		} catch (err) {
			if (errEl) {
				errEl.textContent = err.message || 'Failed to connect MEGA';
				errEl.classList.remove('hidden');
			}
		}
	});

	// Close Inspector Drawer
	document.getElementById('btn-close-inspector')?.addEventListener('click', closeInspectorDrawer);

	// Header Shortcuts Button
	document.getElementById('btn-shortcuts-toggle')?.addEventListener('click', () => {
		openModal('modal-shortcuts');
	});

	// Context Menu Item Action Dispatcher
	document.querySelectorAll('#file-context-menu [data-ctx-action]').forEach((btn) => {
		btn.addEventListener('click', async (e) => {
			e.stopPropagation();
			const action = btn.getAttribute('data-ctx-action');
			const file = activeContextMenuFile;
			hideContextMenu();
			if (!file) return;

			switch (action) {
				case 'open':
					if (file.is_folder) {
						const targetPath = (file.virtual_path || '/').endsWith('/')
							? `${file.virtual_path || '/'}${file.file_name}/`
							: `${file.virtual_path || '/'}/${file.file_name}/`;
						state.currentPath = targetPath;
						navigateTo('drive', targetPath);
					} else {
						openPreviewModal(file);
					}
					break;
				case 'preview':
					openPreviewModal(file);
					break;
				case 'details':
					openInspectorDrawer(file);
					break;
				case 'download':
					if (!file.is_folder) {
						const link = document.createElement('a');
						link.href = api.downloadUrl(file.id);
						link.download = file.file_name;
						document.body.appendChild(link);
						link.click();
						link.remove();
					}
					break;
				case 'copy-link':
					try {
						const directUrl = `${window.location.origin}${api.downloadUrl(file.id)}`;
						await navigator.clipboard.writeText(directUrl);
						showToast('Download link copied to clipboard!', 'success');
					} catch {
						showToast('Failed to copy link', 'error');
					}
					break;
				case 'copy-path':
					try {
						const fullPath = (file.virtual_path || '/') + file.file_name;
						await navigator.clipboard.writeText(fullPath);
						showToast('Virtual path copied to clipboard!', 'success');
					} catch {
						showToast('Failed to copy path', 'error');
					}
					break;
				case 'star':
					try {
						const newStatus = !file.is_starred;
						await api.toggleStar(file.id, newStatus);
						file.is_starred = newStatus;
						updateFileDisplayArea();
						showToast(newStatus ? 'Added to starred' : 'Removed from starred', 'success');
					} catch (err) {
						showToast(err.message || 'Failed to update star', 'error');
					}
					break;
				case 'rename':
					openRenameModal(file.id, file.file_name);
					break;
				case 'delete':
					openDeleteModal(file.id, file.file_name);
					break;
				case 'qr':
					openQrModal(file);
					break;
			}
		});
	});

	// Preview Modal Carousel & QR Buttons
	document.getElementById('btn-preview-prev')?.addEventListener('click', () => navigatePreview(-1));
	document.getElementById('btn-preview-next')?.addEventListener('click', () => navigatePreview(1));
	document.getElementById('btn-preview-stage-prev')?.addEventListener('click', () => navigatePreview(-1));
	document.getElementById('btn-preview-stage-next')?.addEventListener('click', () => navigatePreview(1));
	document.getElementById('preview-qr-btn')?.addEventListener('click', () => {
		if (state.previewList && state.previewList.length && state.previewIndex >= 0) {
			const curr = state.previewList[state.previewIndex];
			if (curr) openQrModal(curr);
		}
	});

	// Mobile QR Direct Link Copy
	document.getElementById('btn-copy-qr-link')?.addEventListener('click', async () => {
		const input = document.getElementById('qr-direct-link-input');
		if (input && input.value) {
			try {
				await navigator.clipboard.writeText(input.value);
				showToast('Direct download link copied!', 'success');
			} catch {
				showToast('Failed to copy link', 'error');
			}
		}
	});

	// Custom Account Alias Form Handlers
	document.getElementById('form-edit-alias')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const accountId = document.getElementById('edit-alias-account-id').value;
		const nickname = document.getElementById('input-account-alias').value.trim();
		setAccountAlias(accountId, nickname);
		closeModal('modal-edit-alias');
		showToast(nickname ? `Nickname set to "${nickname}"` : 'Nickname reset to default', 'success');
		updateSidebarDrivesList();
		await renderCurrentView();
	});

	document.getElementById('btn-reset-alias')?.addEventListener('click', async () => {
		const accountId = document.getElementById('edit-alias-account-id').value;
		setAccountAlias(accountId, '');
		closeModal('modal-edit-alias');
		showToast('Nickname reset to default', 'info');
		updateSidebarDrivesList();
		await renderCurrentView();
	});

	// Close context menu on outside click or scroll
	document.addEventListener('click', (e) => {
		if (!e.target.closest('#file-context-menu')) {
			hideContextMenu();
		}
	});
	window.addEventListener('scroll', hideContextMenu, true);
}

// ==========================================================================
// Keyboard Navigation & Shortcuts Hub
// ==========================================================================

function initKeyboardShortcuts() {
	window.addEventListener('keydown', (e) => {
		const targetTag = e.target.tagName;
		const isInputActive = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || e.target.isContentEditable;

		// Preview Modal Carousel Navigation (Left / Right Arrows)
		const previewModal = document.getElementById('modal-preview');
		if (previewModal && !previewModal.classList.contains('hidden')) {
			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				navigatePreview(-1);
				return;
			}
			if (e.key === 'ArrowRight') {
				e.preventDefault();
				navigatePreview(1);
				return;
			}
		}

		// Escape is universally active
		if (e.key === 'Escape') {
			hideContextMenu();
			closeInspectorDrawer();
			document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
			document.getElementById('search-dropdown')?.classList.add('hidden');
			document.getElementById('new-dropdown')?.classList.add('hidden');
			if (state.selectedFileIds.size > 0) {
				state.selectedFileIds.clear();
				updateSelectionHighlight();
				updateSelectionBar();
			}
			return;
		}

		if (isInputActive) return;

		// Shortcuts cheat sheet: ? or Shift+/
		if (e.key === '?' || (e.shiftKey && e.key === '/')) {
			e.preventDefault();
			openModal('modal-shortcuts');
			return;
		}

		// Select All: Ctrl+A / Cmd+A
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
			e.preventDefault();
			state.selectedFileIds.clear();
			state.files.forEach((f) => state.selectedFileIds.add(f.id));
			updateSelectionHighlight();
			updateSelectionBar();
			return;
		}

		// Delete / Backspace
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (state.selectedFileIds.size > 0) {
				e.preventDefault();
				openBulkDeleteModal();
			}
			return;
		}

		// Space: Quick Look / Preview
		if (e.key === ' ' || e.code === 'Space') {
			if (state.selectedFileIds.size > 0) {
				e.preventDefault();
				const firstId = Array.from(state.selectedFileIds)[0];
				const file = state.files.find((f) => f.id === firstId);
				if (file && !file.is_folder) {
					openPreviewModal(file);
				}
			}
			return;
		}

		// Enter: Open folder or preview file
		if (e.key === 'Enter') {
			if (state.selectedFileIds.size === 1) {
				e.preventDefault();
				const selectedId = Array.from(state.selectedFileIds)[0];
				const file = state.files.find((f) => f.id === selectedId);
				if (file) {
					if (file.is_folder) {
						const targetPath = (file.virtual_path || '/').endsWith('/')
							? `${file.virtual_path || '/'}${file.file_name}/`
							: `${file.virtual_path || '/'}/${file.file_name}/`;
						state.currentPath = targetPath;
						navigateTo('drive', targetPath);
					} else {
						openPreviewModal(file);
					}
				}
			}
			return;
		}

		// F2: Rename
		if (e.key === 'F2') {
			if (state.selectedFileIds.size === 1) {
				e.preventDefault();
				const selectedId = Array.from(state.selectedFileIds)[0];
				const file = state.files.find((f) => f.id === selectedId);
				if (file) {
					openRenameModal(file.id, file.file_name);
				}
			}
			return;
		}

		// Alt+I or I: Item Details
		if ((e.altKey && e.key.toLowerCase() === 'i') || e.key.toLowerCase() === 'i') {
			if (state.selectedFileIds.size > 0) {
				e.preventDefault();
				const selectedId = Array.from(state.selectedFileIds)[0];
				const file = state.files.find((f) => f.id === selectedId);
				if (file) {
					const drawer = document.getElementById('file-inspector-drawer');
					if (drawer && !drawer.classList.contains('hidden') && state.inspectorFile?.id === file.id) {
						closeInspectorDrawer();
					} else {
						openInspectorDrawer(file);
					}
				}
			}
			return;
		}

		// Arrow Up / Down selection cycling
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!state.files.length) return;
			e.preventDefault();
			const files = state.files;
			const currentSelectedId = state.lastSelectedFileId || Array.from(state.selectedFileIds)[0];
			let nextIdx = 0;
			if (currentSelectedId) {
				const currIdx = files.findIndex((f) => f.id === currentSelectedId);
				if (currIdx !== -1) {
					nextIdx = e.key === 'ArrowDown' ? Math.min(files.length - 1, currIdx + 1) : Math.max(0, currIdx - 1);
				}
			}
			const nextFile = files[nextIdx];
			if (nextFile) {
				state.selectedFileIds.clear();
				state.selectedFileIds.add(nextFile.id);
				state.lastSelectedFileId = nextFile.id;
				updateSelectionHighlight();
				updateSelectionBar();
				const targetEl = document.querySelector(`[data-file-id="${nextFile.id}"]`);
				targetEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}
	});
}

// ==========================================================================
// Toast System
// ==========================================================================

export function showToast(message, type = 'info') {
	const container = document.getElementById('toast-container');
	if (!container) return;

	const toast = document.createElement('div');
	toast.className = `toast toast-${type}`;
	toast.innerHTML = `<span>${message}</span>`;
	container.appendChild(toast);

	setTimeout(() => {
		toast.style.opacity = '0';
		toast.style.transform = 'translateY(-6px)';
		toast.style.transition = 'all 0.2s ease';
		setTimeout(() => toast.remove(), 200);
	}, 3500);
}
