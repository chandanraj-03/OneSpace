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
	accounts: [],
	selectedFileIds: new Set(),
	viewMode: localStorage.getItem('onespace-view-mode') || 'grid',
	sortBy: 'name',
	theme: (function() {
		const saved = localStorage.getItem('onespace-theme');
		if (!saved || saved === 'dark') {
			localStorage.setItem('onespace-theme', 'light');
			return 'light';
		}
		return saved;
	})(),
	usedSpace: 0,
	activeUploads: new Map(),
	globalSearchTerm: '',
	authUser: (function() {
		try {
			return JSON.parse(localStorage.getItem('onespace-session-user'));
		} catch {
			return null;
		}
	})(),
};

// ==========================================================================
// Initialization
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
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
	initGlobalSearch();
	initUploadHandlers();
	if (isUserLoggedIn()) {
		await refreshAccounts();
	}
});

// ==========================================================================
// Theme Management
// ==========================================================================

function initTheme() {
	document.documentElement.setAttribute('data-theme', state.theme);
	updateThemeIcon();
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
	const googlePhotosParam = searchParams.get('google_photos') || hashParams.get('google_photos');
	const dropboxParam = searchParams.get('dropbox') || hashParams.get('dropbox');
	const errorParam = searchParams.get('error') || hashParams.get('error');

	if (googleParam === 'connected') {
		showToast('Google Drive successfully connected to your OneSpace pool!', 'success');
		if (isUserLoggedIn()) {
			refreshAccounts();
			api.runSync().then(() => renderCurrentView()).catch(() => {});
		}
		cleanUrlOAuthParams();
	} else if (googlePhotosParam === 'connected') {
		showToast('Google Photos successfully connected to your OneSpace library!', 'success');
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
		} else {
			state.authUser = null;
			localStorage.removeItem('onespace-session-user');
		}
	} catch {
		state.authUser = null;
		localStorage.removeItem('onespace-session-user');
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
		return `
			<a href="#storage" class="sidebar-drive-item" title="${meta.label} (${acc.email || 'Connected'}): ${used} of ${total}">
				<img src="${meta.icon}" alt="${meta.label}" class="sidebar-drive-icon" onerror="this.style.display='none'">
				<span class="sidebar-drive-name truncate">${acc.email || meta.label}</span>
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
							return `
								<div class="home-cloud-card">
									<div class="home-cloud-info">
										<img src="${meta.icon}" alt="${meta.label}" class="home-cloud-icon" onerror="this.style.display='none'">
										<div class="truncate">
											<div class="home-cloud-name truncate">${acc.email || meta.label}</div>
											<div class="home-cloud-meta tabular-nums">${used} / ${total}</div>
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

// --------------------------------------------------------------------------
// My Drive View
// --------------------------------------------------------------------------

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
						<option value="all">All Items</option>
						<option value="folders">Folders Only</option>
						<option value="images">Images</option>
						<option value="documents">Documents</option>
						<option value="archives">Archives</option>
					</select>

					<select id="sort-by-select" class="filter-select">
						<option value="name">Name (A-Z)</option>
						<option value="date">Date Modified</option>
						<option value="size">File Size</option>
					</select>

					<div class="view-toggle-group">
						<button type="button" id="btn-view-grid" class="btn-toggle ${state.viewMode === 'grid' ? 'active' : ''}" title="Grid View">
							${icons.grid}
						</button>
						<button type="button" id="btn-view-table" class="btn-toggle ${state.viewMode === 'table' ? 'active' : ''}" title="List View">
							${icons.list}
						</button>
					</div>

					<button type="button" id="btn-toolbar-upload" class="btn-primary btn-sm">
						${icons.upload}
						<span>Upload</span>
					</button>
				</div>
			</div>

			<!-- Dynamic Selection Action Bar -->
			<div id="selection-bar" class="selection-bar hidden">
				<span id="selection-count" class="tabular-nums" style="font-weight: 600;">0 items selected</span>
				<div class="selection-actions">
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

	// Bind toolbar events
	document.querySelectorAll('[data-crumb-path]').forEach((crumb) => {
		crumb.addEventListener('click', (e) => {
			const path = e.currentTarget.getAttribute('data-crumb-path');
			state.currentPath = path;
			navigateTo('drive', path);
		});
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
		updateFileDisplayArea();
	});

	// Selection Actions
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

// --------------------------------------------------------------------------
// Storage & Accounts View
// --------------------------------------------------------------------------

async function renderStorageView(container) {
	await refreshAccounts();

	let allocationData = { strategy: 'round_robin', order: [] };
	try {
		allocationData = await api.getAllocation();
	} catch (e) {
		console.warn('Could not load allocation data:', e);
	}

	const freeSpace = Math.max(0, state.totalSpace - state.usedSpace);

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
						return `
							<div class="account-card" data-account-id="${acc.id}">
								<div class="account-info">
									<div class="account-icon-wrap">
										<img src="${meta.icon}" alt="${meta.label}" onerror="this.src='/src/assets/logo.webp'">
									</div>
									<div>
										<div class="account-email">${acc.email || 'Connected Account'}</div>
										<div class="account-provider">${meta.label} • <span class="badge-status ${acc.status || 'connected'}">${acc.status || 'Active'}</span></div>
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

					<div class="provider-connect-card" id="btn-conn-google-photos">
						<div class="provider-card-icon">
							<img src="/src/assets/google-photos.svg" alt="Google Photos">
						</div>
						<div>
							<div class="provider-card-title">Google Photos</div>
							<div class="provider-card-desc">Sync albums, photos & media</div>
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

	document.getElementById('btn-conn-google-photos')?.addEventListener('click', async () => {
		const btn = document.getElementById('btn-conn-google-photos');
		if (!isUserLoggedIn()) {
			showToast('Please sign in with Google first to link Google Photos.', 'info');
			navigateTo('login');
			return;
		}
		try {
			if (btn) btn.style.opacity = '0.6';
			const res = await api.getGooglePhotosConnectUrl();
			const url = res?.data?.authorizationUrl || res?.authorizationUrl || res?.url;
			if (url) {
				window.location.href = url;
			} else {
				throw new Error('Google Photos authorization URL not returned by server.');
			}
		} catch (err) {
			if (btn) btn.style.opacity = '';
			showToast(err.message || 'Google Photos not configured in backend/.env', 'error');
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

	// Filter
	if (state.filterType === 'folders') {
		files = files.filter((f) => f.is_folder);
	} else if (state.filterType === 'images') {
		files = files.filter((f) => !f.is_folder && /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(f.file_name));
	} else if (state.filterType === 'documents') {
		files = files.filter((f) => !f.is_folder && /\.(pdf|docx?|xlsx?|pptx?|txt|md)$/i.test(f.file_name));
	} else if (state.filterType === 'archives') {
		files = files.filter((f) => !f.is_folder && /\.(zip|tar|gz|rar|7z)$/i.test(f.file_name));
	}

	// Sort: Folders first, then sort by criteria
	files.sort((a, b) => {
		if (a.is_folder && !b.is_folder) return -1;
		if (!a.is_folder && b.is_folder) return 1;

		if (state.sortBy === 'name') {
			return (a.file_name || '').localeCompare(b.file_name || '');
		} else if (state.sortBy === 'size') {
			return (Number(b.size) || 0) - (Number(a.size) || 0);
		} else if (state.sortBy === 'date') {
			return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
		}
		return 0;
	});

	if (!files.length) {
		return `
			<div class="empty-state">
				<div class="empty-icon">${icons.folder}</div>
				<h3 class="empty-title">This folder is empty</h3>
				<p class="empty-sub">Upload files or drag-and-drop here to start organizing your cloud drive.</p>
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
	return `
		<div class="file-table-wrap">
			<table class="file-table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Provider</th>
						<th>Size</th>
						<th>Modified</th>
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
								<td>
									<div class="table-file-cell">
										${icon}
										<span class="truncate" style="max-width:340px;" title="${file.file_name}">${file.file_name}</span>
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
// File Interactions (Click, Double Click, Context Actions)
// --------------------------------------------------------------------------

function bindFileInteractions() {
	document.querySelectorAll('[data-file-id]').forEach((el) => {
		const fileId = el.getAttribute('data-file-id');
		const isFolder = el.getAttribute('data-is-folder') === 'true';
		const filePath = el.getAttribute('data-file-path');

		// Click to select
		el.addEventListener('click', (e) => {
			if (e.target.closest('[data-action]') || e.target.closest('a')) return;

			if (e.ctrlKey || e.metaKey) {
				if (state.selectedFileIds.has(fileId)) {
					state.selectedFileIds.delete(fileId);
				} else {
					state.selectedFileIds.add(fileId);
				}
			} else {
				state.selectedFileIds.clear();
				state.selectedFileIds.add(fileId);
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
	btn.onclick = async () => {
		try {
			await api.deleteFile(fileId);
			closeModal('modal-delete');
			showToast(`Deleted ${name}`, 'success');
			renderCurrentView();
			refreshAccounts();
		} catch (err) {
			showToast(err.message || 'Failed to delete item', 'error');
		}
	};
	document.getElementById('delete-modal-msg').textContent = `Are you sure you want to delete "${name}"? This action cannot be undone.`;
	openModal('modal-delete');
}

function openBulkDeleteModal() {
	const ids = Array.from(state.selectedFileIds);
	if (!ids.length) return;

	const btn = document.getElementById('btn-confirm-delete');
	btn.onclick = async () => {
		try {
			await api.deleteFiles(ids);
			state.selectedFileIds.clear();
			updateSelectionBar();
			closeModal('modal-delete');
			showToast(`Deleted ${ids.length} items`, 'success');
			renderCurrentView();
			refreshAccounts();
		} catch (err) {
			showToast(err.message || 'Failed to delete items', 'error');
		}
	};
	document.getElementById('delete-modal-msg').textContent = `Are you sure you want to delete ${ids.length} selected items?`;
	openModal('modal-delete');
}

function openPreviewModal(file) {
	document.getElementById('preview-title').textContent = file.file_name;
	document.getElementById('preview-meta').textContent = `${formatBytes(file.size)} • ${getProviderMeta(file.provider).label}`;
	document.getElementById('preview-download-btn').href = api.downloadUrl(file.id);

	const body = document.getElementById('preview-body');
	const mime = (file.mime_type || '').toLowerCase();
	const isImage = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.file_name);
	const isText = mime.startsWith('text/') || /\.(txt|json|js|ts|html|css|py|md|csv)$/i.test(file.file_name);

	if (isImage) {
		body.innerHTML = `<img src="${api.previewUrl(file.id)}" alt="${file.file_name}" class="preview-img" onerror="this.src='/src/assets/logo.webp'">`;
	} else if (isText) {
		body.innerHTML = `<div class="upload-spinner"></div>`;
		fetch(api.previewUrl(file.id))
			.then((r) => r.text())
			.then((text) => {
				body.innerHTML = `<pre class="preview-code">${escapeHtml(text.slice(0, 50000))}</pre>`;
			})
			.catch(() => {
				body.innerHTML = `<p class="empty-sub">Preview not available. Use the download button above.</p>`;
			});
	} else {
		body.innerHTML = `
			<div class="empty-state">
				<div class="empty-icon">${getFileIcon(file)}</div>
				<h3 class="empty-title">${file.file_name}</h3>
				<p class="empty-sub">Direct file preview is not supported for this file type.</p>
			</div>
		`;
	}

	openModal('modal-preview');
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

	// Global Drag & Drop Overlay
	let dragDepth = 0;
	const overlay = document.getElementById('drop-overlay');

	window.addEventListener('dragenter', (e) => {
		e.preventDefault();
		dragDepth++;
		overlay?.classList.remove('hidden');
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

	showUploadToast();
	const toastStatus = document.getElementById('upload-toast-status');
	const toastBar = document.getElementById('upload-toast-bar');

	let completedCount = 0;
	const totalFiles = fileList.length;

	for (const file of fileList) {
		const relativePath = file.webkitRelativePath || file.name;
		const folderPrefix = relativePath.includes('/') ? '/' + relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
		const targetVirtualPath = state.currentPath === '/' ? (folderPrefix || '/') : (state.currentPath + folderPrefix);

		try {
			if (toastStatus) {
				toastStatus.textContent = `Uploading ${file.name} (${completedCount + 1}/${totalFiles})...`;
			}

			// 1. Initiate upload
			const initiation = await api.initiateUpload({
				file_name: file.name,
				file_size: file.size,
				virtual_path: targetVirtualPath,
				mime_type: file.type || 'application/octet-stream',
			});

			const uploadId = initiation.upload_id || initiation.id;

			// 2. Attach WebSocket progress listener
			try {
				const socket = api.createUploadSocket(uploadId);
				socket.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						if (data.type === 'upload:progress' && toastBar) {
							toastBar.style.width = `${data.progress || 0}%`;
						}
					} catch {}
				};
			} catch (wsErr) {
				console.warn('Upload WebSocket listener error:', wsErr);
			}

			// 3. Stream file payload
			await api.uploadFile(uploadId, file);
			completedCount++;
			showToast(`Uploaded ${file.name}`, 'success');
		} catch (err) {
			showToast(`Failed to upload ${file.name}: ${err.message}`, 'error');
		}
	}

	if (toastStatus) toastStatus.textContent = `Uploaded ${completedCount} of ${totalFiles} files.`;
	if (toastBar) toastBar.style.width = '100%';

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

	input?.addEventListener('input', (e) => {
		const val = e.target.value.trim();
		clearBtn?.classList.toggle('hidden', !val);

		if (debounceTimeout) clearTimeout(debounceTimeout);

		if (!val) {
			dropdown?.classList.add('hidden');
			return;
		}

		debounceTimeout = setTimeout(async () => {
			try {
				const results = await api.searchFiles(val, 20);
				const files = results.data || results.files || [];

				if (!files.length) {
					list.innerHTML = `<div style="padding:1rem;color:var(--text-muted);text-align:center;font-size:0.84rem;">No files found matching "${escapeHtml(val)}"</div>`;
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
		}, 200);
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
				localStorage.removeItem('onespace-session-user');
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
				localStorage.removeItem('onespace-session-user');
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
