function resolveApiBaseUrl() {
	const raw = import.meta.env.VITE_API_BASE_URL;
	if (raw && raw !== 'https://onespace-api.onrender.com/api') {
		return raw;
	}
	if (typeof window !== 'undefined') {
		const host = window.location.hostname;
		if (host.endsWith('.onrender.com') || host.endsWith('.vercel.app')) {
			return 'https://onespace-api-hkdi.onrender.com/api';
		}
	}
	return raw || 'http://localhost:8787/api';
}

function resolveWsBaseUrl(apiBase) {
	const raw = import.meta.env.VITE_WS_BASE_URL;
	if (raw && raw !== 'wss://onespace-api.onrender.com/ws/uploads') {
		return raw;
	}
	if (typeof window !== 'undefined') {
		const host = window.location.hostname;
		if (host.endsWith('.onrender.com') || host.endsWith('.vercel.app')) {
			return 'wss://onespace-api-hkdi.onrender.com/ws/uploads';
		}
	}
	return raw || apiBase.replace(/^http/, 'ws').replace(/\/api$/, '/ws/uploads');
}

export const API_BASE_URL = resolveApiBaseUrl();
export const WS_BASE_URL = resolveWsBaseUrl(API_BASE_URL);

async function request(path, options = {}) {
	const headers = {
		'Content-Type': 'application/json',
		...(options.headers || {}),
	};

	const token = localStorage.getItem('onespace-session-token');
	if (token && !headers['Authorization']) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const response = await fetch(`${API_BASE_URL}${path}`, {
		credentials: 'include',
		headers,
		...options,
	});

	if (!response.ok) {
		const payload = await response.json().catch(() => ({ error: 'Unknown API error' }));
		const error = new Error(payload.error || 'API request failed');
		error.status = response.status;
		throw error;
	}

	return response.json();
}

export const authApi = {
	me() {
		return request('/auth/me');
	},
	logout() {
		return request('/auth/logout', {
			method: 'POST',
		});
	},
};

export const api = {
	listFiles(virtualPath = '/') {
		const query = new URLSearchParams({ path: virtualPath }).toString();
		return request(`/files?${query}`);
	},
	searchFiles(term, limit = 50) {
		const query = new URLSearchParams({ search: term, limit: String(limit) }).toString();
		return request(`/files?${query}`);
	},
	listStarredFiles() {
		return request('/files?starred=1');
	},
	listRecentFiles() {
		return request('/files?recent=1');
	},
	listSharedWithMeFiles() {
		return request('/files?shared=1');
	},
	createFolder(payload) {
		return request('/files/folders', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	renameFile(fileId, payload) {
		return request(`/files/${fileId}/rename`, {
			method: 'PATCH',
			body: JSON.stringify(payload),
		});
	},
	toggleStar(fileId, isStarred = true) {
		return request(`/files/${fileId}/star`, {
			method: 'PATCH',
			body: JSON.stringify({ is_starred: isStarred }),
		});
	},
	deleteFile(fileId) {
		return request(`/files/${fileId}`, {
			method: 'DELETE',
		});
	},
	deleteFiles(fileIds) {
		return request('/files/bulk/delete', {
			method: 'POST',
			body: JSON.stringify({ ids: fileIds }),
		});
	},
	getGoogleConnectUrl() {
		return request('/accounts/google/connect');
	},
	getDropboxConnectUrl() {
		return request('/accounts/dropbox/connect');
	},
	connectMegaAccount(payload) {
		return request('/accounts/mega/connect', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
	},
	listAccounts() {
		return request('/accounts');
	},
	disconnectAccount(accountId) {
		return request(`/accounts/${accountId}`, {
			method: 'DELETE',
		});
	},
	runSync() {
		return request('/sync/run', {
			method: 'POST',
		});
	},
	initiateUpload(payload, options = {}) {
		return request('/uploads/initiate', {
			method: 'POST',
			body: JSON.stringify(payload),
			signal: options.signal,
		});
	},
	async uploadFile(uploadId, file, options = {}) {
		if (!uploadId) {
			throw new Error('Upload ID is missing or invalid');
		}

		const formData = new FormData();
		formData.append('file', file);

		const uploadHeaders = { ...(options.headers || {}) };
		const token = localStorage.getItem('onespace-session-token');
		if (token && !uploadHeaders['Authorization']) {
			uploadHeaders['Authorization'] = `Bearer ${token}`;
		}
		if (token && !uploadHeaders['X-Session-Token']) {
			uploadHeaders['X-Session-Token'] = token;
		}

		const response = await fetch(`${API_BASE_URL}/uploads/${uploadId}/stream`, {
			method: 'POST',
			credentials: 'include',
			headers: uploadHeaders,
			body: formData,
			signal: options.signal,
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			let msg = 'Upload failed';
			try {
				const payload = JSON.parse(text);
				msg = payload.error || payload.message || msg;
			} catch {
				if (text) msg = text;
			}
			throw new Error(msg);
		}

		return response.json();
	},
	createUploadSocket(uploadId) {
		return new WebSocket(`${WS_BASE_URL}?uploadId=${encodeURIComponent(uploadId)}`);
	},
	downloadUrl(fileId) {
		const token = localStorage.getItem('onespace-session-token');
		const base = `${API_BASE_URL}/files/${fileId}/download`;
		return token ? `${base}?token=${encodeURIComponent(token)}` : base;
	},
	previewUrl(fileId) {
		const token = localStorage.getItem('onespace-session-token');
		const base = `${API_BASE_URL}/files/${fileId}/preview`;
		return token ? `${base}?token=${encodeURIComponent(token)}` : base;
	},
	getAllocation() {
		return request('/allocation');
	},
	updateAllocation(payload) {
		return request('/allocation', {
			method: 'PATCH',
			body: JSON.stringify(payload),
		});
	},
	checkHealth(timeoutMs = 6000) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		return fetch(`${API_BASE_URL}/health`, {
			method: 'GET',
			signal: controller.signal,
			headers: { Accept: 'application/json' },
		})
			.then(async (res) => {
				clearTimeout(timeoutId);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				throw err;
			});
	},
};
