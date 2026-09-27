import { api, API_BASE_URL } from './api.js';

let currentStatus = 'checking'; // 'checking' | 'waking' | 'active' | 'error'
let wakeStartTime = null;
let pollTimer = null;
let heartbeatTimer = null;
let lastLatency = null;
let elapsedTimer = null;

export function getBackendStatus() {
	return {
		status: currentStatus,
		latency: lastLatency,
		apiUrl: API_BASE_URL,
	};
}

export function initBackendStatus() {
	wakeStartTime = Date.now();
	checkBackend();
}

export async function checkBackend(isManual = false) {
	const pingStart = Date.now();
	try {
		// Ping health endpoint with 5-second timeout
		await api.checkHealth(5000);
		lastLatency = Date.now() - pingStart;
		setStatus('active');
	} catch {
		// If check failed and we're not yet marked active, container is sleeping / starting up
		setStatus('waking');
		startPolling();
	}
}

function startPolling() {
	if (pollTimer) return;

	// Update seconds counter every second
	if (!elapsedTimer) {
		elapsedTimer = setInterval(() => {
			if (currentStatus !== 'waking') {
				clearInterval(elapsedTimer);
				elapsedTimer = null;
				return;
			}
			const elapsed = Math.floor((Date.now() - wakeStartTime) / 1000);
			const timerEl = document.getElementById('wake-elapsed-timer');
			if (timerEl) {
				timerEl.textContent = `${elapsed}s`;
			}
		}, 1000);
	}

	pollTimer = setInterval(async () => {
		const pingStart = Date.now();
		try {
			await api.checkHealth(4000);
			lastLatency = Date.now() - pingStart;
			setStatus('active');
		} catch {
			// Still waking up
			updateUI();
		}
	}, 3000);
}

function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	if (elapsedTimer) {
		clearInterval(elapsedTimer);
		elapsedTimer = null;
	}
}

function startHeartbeat() {
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	// Send keep-alive every 3.5 minutes (210s) to prevent Render free-tier container from sleeping
	heartbeatTimer = setInterval(async () => {
		try {
			const start = Date.now();
			await api.checkHealth(6000);
			lastLatency = Date.now() - start;
			if (currentStatus !== 'active') {
				setStatus('active');
			}
		} catch {
			setStatus('waking');
			startPolling();
		}
	}, 210000);
}

export function setStatus(newStatus) {
	const prevStatus = currentStatus;
	currentStatus = newStatus;

	if (newStatus === 'active') {
		stopPolling();
		startHeartbeat();
		if (prevStatus !== 'active') {
			window.dispatchEvent(new CustomEvent('backend:active', { detail: { latency: lastLatency } }));
		}
	}

	updateUI();
}

export function updateUI() {
	const isWaking = currentStatus === 'waking' || currentStatus === 'checking';
	const isActive = currentStatus === 'active';
	const isError = currentStatus === 'error';

	// 1. Top Global Wake Banner
	const wakeBanner = document.getElementById('backend-wake-banner');
	if (wakeBanner) {
		if (isWaking) {
			wakeBanner.classList.remove('hidden', 'banner-active');
			wakeBanner.classList.add('banner-waking');
		} else if (isActive) {
			// Flash brief ready state then collapse
			wakeBanner.classList.add('banner-active');
			setTimeout(() => {
				if (currentStatus === 'active') {
					wakeBanner.classList.add('hidden');
				}
			}, 2400);
		} else {
			wakeBanner.classList.remove('hidden');
			wakeBanner.classList.add('banner-error');
		}
	}

	// 2. All status pills (.backend-status-pill) across the app
	document.querySelectorAll('.backend-status-pill').forEach((pill) => {
		pill.classList.remove('status-active', 'status-waking', 'status-error');

		const textEl = pill.querySelector('.status-indicator-text');
		if (isActive) {
			pill.classList.add('status-active');
			pill.title = `Render Active • Response time: ${lastLatency || 45}ms • Go 1.24`;
			if (textEl) textEl.textContent = 'Render Active';
		} else if (isWaking) {
			pill.classList.add('status-waking');
			pill.title = 'Render Inactive / Waking Up • Free container spinning up (~30-45s)';
			if (textEl) textEl.textContent = 'Render Inactive / Waking Up';
		} else {
			pill.classList.add('status-error');
			pill.title = 'Render Backend Unreachable • Click to retry';
			if (textEl) textEl.textContent = 'Render Offline';
		}
	});
}
