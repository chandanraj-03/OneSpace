import { icons } from '../icons.js';
import { API_BASE_URL } from '../services/api.js';

export function renderLoginView(container, { state, navigateTo, toggleTheme, showToast }) {
	function render() {
		container.innerHTML = `
			<div class="login-page-root">
				<div class="login-ambient-glow glow-top"></div>
				<div class="login-ambient-glow glow-bottom"></div>

				<!-- Top Navigation -->
				<header class="login-top-nav">
					<a href="#landing" class="login-back-link">
						${icons.arrowLeft}
						<span>Back to OneSpace</span>
					</a>
					<div class="login-nav-right" style="display: flex; align-items: center; gap: 12px;">
						<div id="login-backend-pill" class="backend-status-pill status-waking" title="Backend: Render Inactive / Waking Up">
							<span class="status-indicator-dot"></span>
							<span class="status-indicator-text">Render Inactive / Waking Up</span>
						</div>
						<button type="button" id="login-theme-toggle" class="btn-icon" title="Toggle theme">
							<span>${state.theme === 'dark' ? icons.sun : icons.moon}</span>
						</button>
					</div>
				</header>

				<!-- Authentication Center Card -->
				<div class="login-card-container">
					<div class="login-card glass-panel">
						<!-- Brand Header -->
						<div class="login-brand-header">
							<a href="#landing" class="login-brand-anchor">
								<img src="/src/assets/logo.webp" alt="OneSpace" class="login-logo" onerror="this.style.display='none'">
								<span class="login-brand-title">OneSpace</span>
							</a>
							<h1 class="login-title">Sign in to OneSpace</h1>
							<p class="login-subtitle">
								Unified Multi-Cloud Virtual Drive Workspace
							</p>
						</div>

						<!-- Anti-Spam Security Shield Notice -->
						<div class="login-security-shield-card">
							<div class="shield-card-icon-wrap">
								${icons.shield}
							</div>
							<div class="shield-card-text">
								<span class="shield-card-title">Verified Google Sign-In Only</span>
								<p class="shield-card-desc">
									To eliminate fake accounts and spam registrations, OneSpace exclusively permits authentication via verified Google accounts. No separate password needed.
								</p>
							</div>
						</div>

						<!-- Error / Notice Box -->
						<div id="login-alert-box" class="login-alert hidden"></div>

						<!-- 1-Click Google OAuth Sign-In Button -->
						<div class="google-auth-box">
							<a href="${API_BASE_URL}/auth/google" class="btn-google-auth-prominent" id="btn-google-oauth">
								<svg class="google-svg" viewBox="0 0 24 24" width="24" height="24">
									<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
									<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
									<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
									<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
								</svg>
								<div class="google-auth-text-wrap">
									<span class="google-auth-main-text">Continue with Google</span>
									<span class="google-auth-sub-text">Instant 1-click login &amp; account creation</span>
								</div>
								<span class="google-auth-arrow">${icons.arrowRight}</span>
							</a>
						</div>

						<!-- Verification Perks Checklist -->
						<div class="login-perks-card">
							<div class="login-perk-row">
								<span class="perk-check-icon">${icons.check}</span>
								<span class="perk-label"><strong>Instant Access:</strong> Automatic account creation on first login</span>
							</div>
							<div class="login-perk-row">
								<span class="perk-check-icon">${icons.check}</span>
								<span class="perk-label"><strong>Zero Passwords:</strong> Never worry about stolen or forgotten credentials</span>
							</div>
							<div class="login-perk-row">
								<span class="perk-check-icon">${icons.check}</span>
								<span class="perk-label"><strong>Multi-Cloud Pooling:</strong> Aggregate Google Drive, MEGA &amp; Dropbox</span>
							</div>
						</div>


						<!-- Security Footer -->
						<div class="login-security-notice">
							<div class="sec-icons-row">
								<img src="/src/assets/google-drive.svg" alt="Google Drive" class="sec-provider-icon">
								<img src="/src/assets/mega.svg" alt="MEGA" class="sec-provider-icon">
								<img src="/src/assets/dropbox.svg" alt="Dropbox" class="sec-provider-icon">
							</div>
							<p>OAuth 2.0 PKCE • Zero-Knowledge Architecture • AES-256 Storage</p>
						</div>
					</div>
				</div>
			</div>
		`;

		attachListeners();
	}

	function attachListeners() {
		// Check for error in query or hash params (e.g. ?error=... or #login?error=...)
		const urlParams = new URLSearchParams(window.location.search);
		const hashPart = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
		const hashParams = new URLSearchParams(hashPart);
		const errorParam = urlParams.get('error') || hashParams.get('error') || urlParams.get('message') || hashParams.get('message');
		if (errorParam) {
			showAlert(decodeURIComponent(errorParam), 'error');
		}

		// Google OAuth button click
		const googleBtn = container.querySelector('#btn-google-oauth');
		googleBtn?.addEventListener('click', (e) => {
			e.preventDefault();
			window.location.href = `${API_BASE_URL}/auth/google`;
		});

		// Theme toggle
		const themeBtn = container.querySelector('#login-theme-toggle');
		themeBtn?.addEventListener('click', () => {
			toggleTheme();
			render();
		});


	}

	function showAlert(message, type = 'error') {
		const box = container.querySelector('#login-alert-box');
		if (box) {
			box.className = `login-alert alert-${type}`;
			box.innerHTML = `
				<span class="alert-icon">${type === 'error' ? icons.x : icons.sparkles}</span>
				<span class="alert-text">${message}</span>
			`;
			box.classList.remove('hidden');
		}
	}

	render();
}
