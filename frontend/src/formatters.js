import dropboxLogo from './assets/dropbox.svg';
import googleDriveLogo from './assets/google-drive.svg';
import megaLogo from './assets/mega.svg';

export const PROVIDERS = {
	google_drive: {
		key: 'google_drive',
		label: 'Google Drive',
		icon: googleDriveLogo,
		color: '#4285F4',
		accentColor: '#34A853',
		badgeClass: 'provider-google',
	},
	dropbox: {
		key: 'dropbox',
		label: 'Dropbox',
		icon: dropboxLogo,
		color: '#0061FF',
		accentColor: '#3984FF',
		badgeClass: 'provider-dropbox',
	},
	mega: {
		key: 'mega',
		label: 'MEGA',
		icon: megaLogo,
		color: '#D9272E',
		accentColor: '#E0484E',
		badgeClass: 'provider-mega',
	},
};

export function getProviderMeta(provider) {
	return PROVIDERS[provider] || {
		key: provider || 'unknown',
		label: provider || 'Cloud Provider',
		icon: null,
		color: '#64748B',
		accentColor: '#94A3B8',
		badgeClass: 'provider-generic',
	};
}

export function formatBytes(bytes) {
	const parsed = Number(bytes);
	if (!Number.isFinite(parsed) || parsed === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	let val = parsed;
	let unitIndex = 0;
	while (val >= 1024 && unitIndex < units.length - 1) {
		val /= 1024;
		unitIndex++;
	}
	return `${val.toFixed(val >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDate(dateString) {
	if (!dateString) return '—';
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return String(dateString);
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	} catch {
		return String(dateString);
	}
}

export function formatDateTime(dateString) {
	if (!dateString) return '—';
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return String(dateString);
		return date.toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	} catch {
		return String(dateString);
	}
}

export function formatRelativeTime(dateString) {
	if (!dateString) return '—';
	try {
		const date = new Date(dateString);
		const now = new Date();
		const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
		if (isNaN(diffSec)) return formatDate(dateString);
		if (diffSec < 60) return 'Just now';
		if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
		if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
		if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
		return formatDate(dateString);
	} catch {
		return formatDate(dateString);
	}
}
