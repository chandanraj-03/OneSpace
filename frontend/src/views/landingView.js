import { icons } from '../icons.js';
import { formatBytes } from '../formatters.js';

export function renderLandingView(container, { state, navigateTo, toggleTheme, showToast }) {
	const isLoggedIn = Boolean(state.authUser && state.authUser.email && state.authUser.email !== 'guest@onespace.local');

	container.innerHTML = `
		<div class="landing-page-root">
			<!-- Floating Modern Glass Navbar -->
			<header class="landing-navbar" id="landing-navbar">
				<div class="landing-nav-inner">
					<a href="#landing" class="landing-brand">
						<span class="landing-brand-logo-wrap">
							<img src="/src/assets/logo.webp" alt="OneSpace" class="landing-brand-logo" onerror="this.style.display='none'">
						</span>
						<span class="landing-brand-name">OneSpace</span>
						<span class="landing-badge-version">v2.4</span>
					</a>

					<nav class="landing-nav-links">
						<a href="#landing-features" class="landing-nav-anchor">Features</a>
						<a href="#landing-calculator" class="landing-nav-anchor">Calculator</a>
						<a href="#landing-how" class="landing-nav-anchor">How It Works</a>
						<a href="#landing-comparison" class="landing-nav-anchor">Compare</a>
						<a href="#landing-faq" class="landing-nav-anchor">FAQ</a>
					</nav>

					<div class="landing-nav-actions">
						<div id="landing-backend-pill" class="backend-status-pill status-waking" title="Backend: Render Inactive / Waking Up">
							<span class="status-indicator-dot"></span>
							<span class="status-indicator-text">Render Inactive / Waking Up</span>
						</div>
						<button type="button" id="landing-theme-toggle" class="btn-icon" title="Toggle dark/light theme" aria-label="Toggle theme">
							<span id="landing-theme-icon">${state.theme === 'dark' ? icons.sun : icons.moon}</span>
						</button>
						${isLoggedIn ? `
							<a href="#home" class="btn-ghost-sm" id="nav-btn-signin" title="Signed in as ${state.authUser.email}">
								${icons.user}
								<span>${state.authUser.email.split('@')[0]}</span>
							</a>
							<a href="#home" class="btn-primary-sm pulse-glow" id="nav-btn-launch">
								<span>Launch Drive</span>
								${icons.arrowRight}
							</a>
						` : `
							<a href="#login" class="btn-ghost-sm" id="nav-btn-signin">
								<svg class="google-svg" viewBox="0 0 24 24" width="16" height="16">
									<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
									<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
									<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
									<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
								</svg>
								<span>Sign In</span>
							</a>
							<a href="#login" class="btn-primary-sm pulse-glow" id="nav-btn-launch">
								<span>Sign in to Launch</span>
								${icons.arrowRight}
							</a>
						`}
					</div>
				</div>
			</header>

			<!-- Hero Section with Glowing Backdrop -->
			<section class="landing-hero" id="landing-hero">
				<div class="hero-ambient-glow glow-1"></div>
				<div class="hero-ambient-glow glow-2"></div>
				
				<div class="hero-content">
					<div class="hero-pill-badge">
						<span class="pulse-indicator"></span>
						<span class="hero-pill-text">Unified Multi-Cloud Storage Pooling • 100% Free</span>
					</div>

					<h1 class="hero-title">
						One Storage Pool.<br>
						<span class="gradient-text">Infinite Multi-Cloud Freedom.</span>
					</h1>

					<p class="hero-subtitle">
						Aggregate your scattered <strong>Google Drive</strong>, <strong>Dropbox</strong>, and <strong>MEGA</strong> accounts into a single high-performance virtual drive. Stop juggling separate quotas and unlock combined gigabytes for free.
					</p>

					<div class="hero-cta-group">
						<a href="${isLoggedIn ? '#home' : '#login'}" class="hero-btn-primary" id="hero-btn-launch">
							${icons.zap}
							<span>${isLoggedIn ? 'Open Unified Workspace' : 'Sign in with Google to Start'}</span>
						</a>
						<a href="#landing-calculator" class="hero-btn-secondary">
							${icons.hardDrive}
							<span>Calculate Free Storage</span>
						</a>
						${!isLoggedIn ? `
							<a href="#login" class="hero-btn-subtle">
								<svg class="google-svg" viewBox="0 0 24 24" width="16" height="16">
									<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
									<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
									<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
									<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
								</svg>
								<span>Sign In</span>
							</a>
						` : ''}
					</div>

					<div class="hero-trust-bar">
						<div class="trust-item">
							${icons.shield}
							<span>Zero-Knowledge AES-256</span>
						</div>
						<div class="trust-divider">•</div>
						<div class="trust-item">
							${icons.sparkles}
							<span>Sub-20ms Cross-Cloud Search</span>
						</div>
						<div class="trust-divider">•</div>
						<div class="trust-item">
							${icons.layers}
							<span>Intelligent File Striping</span>
						</div>
						<div class="trust-divider">•</div>
						<div class="trust-item">
							${icons.cloud}
							<span>3+ Providers Supported</span>
						</div>
					</div>
				</div>

				<!-- Interactive Hero Storage Pool Simulator -->
				<div class="hero-simulator-wrap">
					<div class="simulator-card glass-panel">
						<div class="simulator-header">
							<div class="simulator-title-group">
								<span class="simulator-status-dot online"></span>
								<span class="simulator-title">Virtual Drive Engine Simulation</span>
							</div>
							<div class="simulator-badge">Live Interactive Simulator</div>
						</div>

						<div class="simulator-body">
							<div class="simulator-cloud-row">
								<div class="cloud-pill-card active" data-provider="google">
									<img src="/src/assets/google-drive.svg" alt="Google Drive" class="provider-mini-icon">
									<div class="cloud-pill-info">
										<span class="cloud-pill-name">Google Drive</span>
										<span class="cloud-pill-cap">15 GB Free</span>
									</div>
									<span class="cloud-pill-status">Connected</span>
								</div>

								<div class="cloud-pill-card active" data-provider="mega">
									<img src="/src/assets/mega.svg" alt="MEGA" class="provider-mini-icon">
									<div class="cloud-pill-info">
										<span class="cloud-pill-name">MEGA Cloud</span>
										<span class="cloud-pill-cap">20 GB Free</span>
									</div>
									<span class="cloud-pill-status">Connected</span>
								</div>

								<div class="cloud-pill-card active" data-provider="dropbox">
									<img src="/src/assets/dropbox.svg" alt="Dropbox" class="provider-mini-icon">
									<div class="cloud-pill-info">
										<span class="cloud-pill-name">Dropbox</span>
										<span class="cloud-pill-cap">2 GB Free</span>
									</div>
									<span class="cloud-pill-status">Connected</span>
								</div>
							</div>

							<!-- Unified Storage Bar -->
							<div class="simulator-unified-pool">
								<div class="pool-header-row">
									<div class="pool-name">
										${icons.hardDrive}
										<span>OneSpace Virtual Pool: <strong>/Volumes/OneSpace</strong></span>
									</div>
									<div class="pool-metrics" id="sim-pool-metrics">
										<span class="pool-used" id="sim-used-val">8.4 GB</span> / <span class="pool-total">37.0 GB Pooled (22% used)</span>
									</div>
								</div>

								<div class="sim-progress-bar">
									<div class="sim-seg gdrive" style="width: 25%;" title="Google Drive: 3.75 GB used"></div>
									<div class="sim-seg mega" style="width: 15%;" title="MEGA: 3.0 GB used"></div>
									<div class="sim-seg dropbox" style="width: 8%;" title="Dropbox: 1.65 GB used"></div>
								</div>

								<div class="sim-legend-row">
									<span class="sim-legend-dot gdrive"></span> <span>Google Drive (15 GB)</span>
									<span class="sim-legend-dot mega"></span> <span>MEGA (20 GB)</span>
									<span class="sim-legend-dot dropbox"></span> <span>Dropbox (2 GB)</span>
									<span class="sim-legend-dot free"></span> <span>28.6 GB Available</span>
								</div>
							</div>

							<!-- Interactive Action Bar -->
							<div class="simulator-actions">
								<button type="button" class="btn-simulator-action" id="btn-simulate-upload">
									${icons.upload}
									<span id="btn-simulate-upload-text">Simulate Smart Multi-Cloud Upload (4.2 GB 4K Video)</span>
								</button>
								<div id="sim-upload-progress" class="sim-upload-progress hidden">
									<div class="sim-upload-status-row">
										<span class="sim-upload-filename">4K-Render-Project.mov</span>
										<span class="sim-upload-pct" id="sim-upload-pct">0%</span>
									</div>
									<div class="sim-upload-bar">
										<div class="sim-upload-fill" id="sim-upload-fill" style="width: 0%;"></div>
									</div>
									<div class="sim-upload-distribution" id="sim-upload-dist">
										Auto-striping: 2.1 GB to MEGA • 1.6 GB to Google Drive • 0.5 GB to Dropbox
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- Live Storage Pool Calculator Section -->
			<section class="landing-section" id="landing-calculator">
				<div class="section-container">
					<div class="section-header-center">
						<span class="section-tag">Interactive Calculator</span>
						<h2 class="section-heading">How Much Free Storage Can You Unlock?</h2>
						<p class="section-subheading">
							Most users have 2-4 old Google accounts and free MEGA storage sitting dormant. See what happens when OneSpace combines them into a single pool.
						</p>
					</div>

					<div class="calculator-card glass-panel">
						<div class="calculator-grid">
							<!-- Sliders Side -->
							<div class="calculator-inputs">
								<h3 class="calc-group-title">Select Your Accounts</h3>
								
								<!-- Google Drive Slider -->
								<div class="calc-control-group">
									<div class="calc-control-header">
										<div class="calc-provider-title">
											<img src="/src/assets/google-drive.svg" alt="Google Drive" class="calc-provider-icon">
											<span>Google Drive Accounts</span>
										</div>
										<span class="calc-value-badge" id="calc-gdrive-count">2 accounts (30 GB)</span>
									</div>
									<input type="range" min="0" max="6" value="2" step="1" class="calc-slider" id="calc-slider-gdrive">
									<div class="calc-ticks">
										<span>0</span><span>1 (15 GB)</span><span>2 (30 GB)</span><span>4 (60 GB)</span><span>6 (90 GB)</span>
									</div>
								</div>

								<!-- MEGA Slider -->
								<div class="calc-control-group">
									<div class="calc-control-header">
										<div class="calc-provider-title">
											<img src="/src/assets/mega.svg" alt="MEGA" class="calc-provider-icon">
											<span>MEGA Cloud Accounts</span>
										</div>
										<span class="calc-value-badge" id="calc-mega-count">2 accounts (40 GB)</span>
									</div>
									<input type="range" min="0" max="5" value="2" step="1" class="calc-slider" id="calc-slider-mega">
									<div class="calc-ticks">
										<span>0</span><span>1 (20 GB)</span><span>2 (40 GB)</span><span>3 (60 GB)</span><span>5 (100 GB)</span>
									</div>
								</div>

								<!-- Dropbox Slider -->
								<div class="calc-control-group">
									<div class="calc-control-header">
										<div class="calc-provider-title">
											<img src="/src/assets/dropbox.svg" alt="Dropbox" class="calc-provider-icon">
											<span>Dropbox Accounts</span>
										</div>
										<span class="calc-value-badge" id="calc-dropbox-count">1 account (2 GB)</span>
									</div>
									<input type="range" min="0" max="4" value="1" step="1" class="calc-slider" id="calc-slider-dropbox">
									<div class="calc-ticks">
										<span>0</span><span>1 (2 GB)</span><span>2 (4 GB)</span><span>3 (6 GB)</span><span>4 (8 GB)</span>
									</div>
								</div>

								<!-- Quick Presets -->
								<div class="calc-presets">
									<span class="calc-presets-label">Quick Presets:</span>
									<button type="button" class="btn-calc-preset" data-g="1" data-m="1" data-d="1">Student (37 GB)</button>
									<button type="button" class="btn-calc-preset active" data-g="2" data-m="2" data-d="1">Pro (72 GB)</button>
									<button type="button" class="btn-calc-preset" data-g="4" data-m="4" data-d="2">Hoarder (144 GB)</button>
								</div>
							</div>

							<!-- Results Side -->
							<div class="calculator-results">
								<div class="result-highlight-card">
									<span class="result-label">Your Free Unified Pool</span>
									<div class="result-number-wrap">
										<span class="result-big-number" id="calc-total-gb">72</span>
										<span class="result-unit">GB</span>
									</div>
									<p class="result-desc">Aggregated seamlessly into a single virtual drive partition without paying a monthly subscription.</p>
								</div>

								<div class="savings-metric-card">
									<div class="savings-icon">${icons.sparkles}</div>
									<div class="savings-info">
										<div class="savings-amount" id="calc-savings">$35.88 / year</div>
										<div class="savings-lbl">Estimated cloud subscription costs saved</div>
									</div>
								</div>

								<div class="calc-pool-breakdown">
									<div class="breakdown-bar">
										<div class="breakdown-fill gdrive" id="calc-bar-gdrive" style="width: 41%;"></div>
										<div class="breakdown-fill mega" id="calc-bar-mega" style="width: 55%;"></div>
										<div class="breakdown-fill dropbox" id="calc-bar-dropbox" style="width: 4%;"></div>
									</div>
									<div class="breakdown-legend">
										<span id="calc-legend-g">Google: 30 GB</span>
										<span id="calc-legend-m">MEGA: 40 GB</span>
										<span id="calc-legend-d">Dropbox: 2 GB</span>
									</div>
								</div>

								<a href="${isLoggedIn ? '#home' : '#login'}" class="btn-claim-pool" id="btn-claim-pool">
									<span>${isLoggedIn ? 'Launch Workspace' : 'Sign in to Claim Storage Pool'}</span>
									${icons.arrowRight}
								</a>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- Core Features Bento Grid -->
			<section class="landing-section" id="landing-features">
				<div class="section-container">
					<div class="section-header-center">
						<span class="section-tag">Next-Gen Architecture</span>
						<h2 class="section-heading">Engineered for Seamless Multi-Cloud Storage</h2>
						<p class="section-subheading">
							Built with high-concurrency Node.js pipelines, MongoDB Atlas metadata caching, and hardware-accelerated crypto.
						</p>
					</div>

					<div class="bento-grid">
						<!-- Feature 1: Unified Namespace (Large) -->
						<div class="bento-card bento-col-2 glass-panel">
							<div class="bento-badge">Virtual VFS</div>
							<div class="bento-icon-box accent-blue">${icons.folder}</div>
							<h3 class="bento-title">Single Unified Filesystem</h3>
							<p class="bento-desc">
								No more logging into three different websites to find a document. OneSpace projects all your files into a clean virtual hierarchy. Folders exist virtually, and files live where storage is cheapest and fastest.
							</p>
							<div class="bento-visual">
								<div class="vfs-tree-preview">
									<div class="tree-item"><span class="tree-icon">${icons.folder}</span><span>/Projects/2026/</span><span class="tree-pill mega">MEGA</span></div>
									<div class="tree-item"><span class="tree-icon">${icons.fileText}</span><span>quarterly-report.pdf</span><span class="tree-pill gdrive">Google Drive</span></div>
									<div class="tree-item"><span class="tree-icon">${icons.fileZip}</span><span>dataset-raw.zip</span><span class="tree-pill dropbox">Dropbox</span></div>
								</div>
							</div>
						</div>

						<!-- Feature 2: Smart Auto-Striping -->
						<div class="bento-card glass-panel">
							<div class="bento-badge">Intelligent Router</div>
							<div class="bento-icon-box accent-purple">${icons.layers}</div>
							<h3 class="bento-title">Automatic Quota Balancing</h3>
							<p class="bento-desc">
								Files are automatically directed to whichever cloud account has free headroom, avoiding "Storage Full" blocks forever.
							</p>
						</div>

						<!-- Feature 3: Sub-20ms Search -->
						<div class="bento-card glass-panel">
							<div class="bento-badge">Instant Query</div>
							<div class="bento-icon-box accent-green">${icons.search}</div>
							<h3 class="bento-title">Global Fuzzy Search</h3>
							<p class="bento-desc">
								Press <kbd class="bento-kbd">Ctrl + K</kbd> to search across all linked accounts simultaneously with instant MongoDB Atlas indexing.
							</p>
						</div>

						<!-- Feature 4: Zero-Knowledge Privacy -->
						<div class="bento-card glass-panel">
							<div class="bento-badge">Privacy First</div>
							<div class="bento-icon-box accent-orange">${icons.shield}</div>
							<h3 class="bento-title">Military-Grade Encryption</h3>
							<p class="bento-desc">
								AES-256 client-side encryption ensures your files are scrambled before they leave your machine. Cloud hosts see only ciphertexts.
							</p>
						</div>

						<!-- Feature 5: In-Browser Media Streaming -->
						<div class="bento-card bento-col-2 glass-panel">
							<div class="bento-badge">Native Playback</div>
							<div class="bento-icon-box accent-cyan">${icons.fileVideo}</div>
							<h3 class="bento-title">Instant Media Previews & 4K Streaming</h3>
							<p class="bento-desc">
								Preview images, stream high-definition videos, read PDFs, and view syntax-highlighted code files directly in your browser without waiting for full downloads.
							</p>
							<div class="bento-visual media-stream-demo">
								<div class="media-demo-badge">▶ Direct Cloud Stream • 0-buffer pipeline</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- How It Works 3-Step Interactive Process -->
			<section class="landing-section" id="landing-how">
				<div class="section-container">
					<div class="section-header-center">
						<span class="section-tag">Simple 3-Step Setup</span>
						<h2 class="section-heading">How OneSpace Unifies Your Storage</h2>
						<p class="section-subheading">
							From fragmented cloud accounts to a unified powerhouse in under two minutes.
						</p>
					</div>

					<div class="steps-grid">
						<div class="step-card glass-panel">
							<div class="step-number">01</div>
							<div class="step-icon-wrap">${icons.link}</div>
							<h3 class="step-title">Link Cloud Accounts</h3>
							<p class="step-desc">
								Authenticate your Google Drive, Dropbox, and MEGA accounts via standard OAuth and token APIs. No passwords saved on remote servers.
							</p>
						</div>

						<div class="step-card glass-panel">
							<div class="step-number">02</div>
							<div class="step-icon-wrap">${icons.cpu}</div>
							<h3 class="step-title">OneSpace Aggregates Quotas</h3>
							<p class="step-desc">
								Our local storage coordinator calculates total pooled capacity, builds a virtual filesystem mapping, and caches metadata in MongoDB Atlas.
							</p>
						</div>

						<div class="step-card glass-panel">
							<div class="step-number">03</div>
							<div class="step-icon-wrap">${icons.zap}</div>
							<h3 class="step-title">Access Like a Native Drive</h3>
							<p class="step-desc">
								Drag, drop, stream, rename, and manage files from one intuitive web workspace. Files distribute across clouds behind the scenes.
							</p>
						</div>
					</div>
				</div>
			</section>

			<!-- Cloud Provider Ecosystem -->
			<section class="landing-section" id="landing-clouds">
				<div class="section-container">
					<div class="section-header-center">
						<span class="section-tag">Supported Providers</span>
						<h2 class="section-heading">Connect Any Cloud Provider</h2>
						<p class="section-subheading">
							Currently supporting the big three free-tier champions with more integrations rolling out.
						</p>
					</div>

					<div class="providers-ecosystem-grid">
						<div class="provider-ecosystem-card glass-panel active">
							<div class="provider-eco-top">
								<img src="/src/assets/google-drive.svg" alt="Google Drive" class="provider-eco-icon">
								<span class="provider-eco-badge ready">Supported</span>
							</div>
							<h3 class="provider-eco-name">Google Drive</h3>
							<p class="provider-eco-meta">15 GB Free • OAuth 2.0 • Resumable Uploads</p>
							<div class="provider-eco-specs">
								<span class="eco-spec-tag">Full API v3</span>
								<span class="eco-spec-tag">Fast CDN</span>
							</div>
						</div>

						<div class="provider-ecosystem-card glass-panel active">
							<div class="provider-eco-top">
								<img src="/src/assets/mega.svg" alt="MEGA" class="provider-eco-icon">
								<span class="provider-eco-badge ready">Supported</span>
							</div>
							<h3 class="provider-eco-name">MEGA</h3>
							<p class="provider-eco-meta">20 GB Free • End-to-End Encrypted • Direct Stream</p>
							<div class="provider-eco-specs">
								<span class="eco-spec-tag">Client Crypto</span>
								<span class="eco-spec-tag">Generous Tier</span>
							</div>
						</div>

						<div class="provider-ecosystem-card glass-panel active">
							<div class="provider-eco-top">
								<img src="/src/assets/dropbox.svg" alt="Dropbox" class="provider-eco-icon">
								<span class="provider-eco-badge ready">Supported</span>
							</div>
							<h3 class="provider-eco-name">Dropbox</h3>
							<p class="provider-eco-meta">2 GB Free • Chunked Uploads • OAuth 2.0</p>
							<div class="provider-eco-specs">
								<span class="eco-spec-tag">High Reliability</span>
								<span class="eco-spec-tag">Instant Sync</span>
							</div>
						</div>

						<div class="provider-ecosystem-card glass-panel upcoming">
							<div class="provider-eco-top">
								<div class="provider-eco-icon upcoming-icon">${icons.cloud}</div>
								<span class="provider-eco-badge upcoming">Coming Soon</span>
							</div>
							<h3 class="provider-eco-name">OneDrive & S3</h3>
							<p class="provider-eco-meta">5 GB Free OneDrive & AWS S3 / WebDAV buckets</p>
							<div class="provider-eco-specs">
								<span class="eco-spec-tag">In Development</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- Comparison Matrix -->
			<section class="landing-section" id="landing-comparison">
				<div class="section-container">
					<div class="section-header-center">
						<span class="section-tag">Value Comparison</span>
						<h2 class="section-heading">Why OneSpace Beats Fragmented Clouds</h2>
						<p class="section-subheading">
							See how OneSpace transforms the way you store, organize, and search your personal data.
						</p>
					</div>

					<div class="table-card glass-panel">
						<table class="landing-compare-table">
							<thead>
								<tr>
									<th>Feature</th>
									<th class="col-highlight">OneSpace</th>
									<th>Google Drive Free</th>
									<th>Multiple Cloud Apps</th>
									<th>Paid Cloud ($20/mo)</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>Combined Storage Capacity</td>
									<td class="col-highlight font-bold text-success">37 GB - 150+ GB Free</td>
									<td>15 GB (Fixed)</td>
									<td>Fragmented across apps</td>
									<td>1 TB - 2 TB</td>
								</tr>
								<tr>
									<td>Unified Single Search</td>
									<td class="col-highlight">${icons.check} Instant (Ctrl+K)</td>
									<td>Google files only</td>
									<td>${icons.x} Manual tab switching</td>
									<td>Single cloud only</td>
								</tr>
								<tr>
									<td>Automatic File Tiering</td>
									<td class="col-highlight">${icons.check} Included</td>
									<td>${icons.x} No</td>
									<td>${icons.x} No</td>
									<td>${icons.x} No</td>
								</tr>
								<tr>
									<td>Zero-Knowledge Encryption</td>
									<td class="col-highlight">${icons.check} Client-Side AES-256</td>
									<td>${icons.x} Scanned for Ads/AI</td>
									<td>Depends on app</td>
									<td>Rare / Extra cost</td>
								</tr>
								<tr>
									<td>Monthly Subscription</td>
									<td class="col-highlight font-bold text-success">$0.00 / forever</td>
									<td>$0.00 (until full)</td>
									<td>$0.00</td>
									<td>$9.99 - $29.99/mo</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</section>

			<!-- Interactive FAQ Accordion -->
			<section class="landing-section" id="landing-faq">
				<div class="section-container faq-container">
					<div class="section-header-center">
						<span class="section-tag">Frequently Asked Questions</span>
						<h2 class="section-heading">Got Questions? We Have Answers.</h2>
						<p class="section-subheading">
							Everything you need to know about security, limits, and multi-cloud pooling.
						</p>
					</div>

					<div class="faq-list">
						<div class="faq-item glass-panel">
							<button type="button" class="faq-question">
								<span>Can I connect multiple accounts from the same provider?</span>
								<span class="faq-chevron">${icons.chevronDown}</span>
							</button>
							<div class="faq-answer">
								<p>Yes! You can link 2, 3, or more Google Drive or MEGA accounts. OneSpace aggregates each account's free allowance (e.g. 3 Google accounts = 45 GB free space) into your unified pool.</p>
							</div>
						</div>

						<div class="faq-item glass-panel">
							<button type="button" class="faq-question">
								<span>Are my files stored on your central servers?</span>
								<span class="faq-chevron">${icons.chevronDown}</span>
							</button>
							<div class="faq-answer">
								<p>No. OneSpace is a client-side aggregator and local controller. Your files are encrypted and transferred directly to your own connected cloud storage accounts (Google Drive, MEGA, Dropbox). We do not run any central storage or read your files.</p>
							</div>
						</div>

						<div class="faq-item glass-panel">
							<button type="button" class="faq-question">
								<span>What happens if one of my cloud accounts is full?</span>
								<span class="faq-chevron">${icons.chevronDown}</span>
							</button>
							<div class="faq-answer">
								<p>Our intelligent storage balancer automatically directs new uploads to the linked accounts that have remaining free space. You will never encounter a "Disk Full" error as long as your overall pool has space.</p>
							</div>
						</div>

						<div class="faq-item glass-panel">
							<button type="button" class="faq-question">
								<span>Can I preview and stream files without downloading them?</span>
								<span class="faq-chevron">${icons.chevronDown}</span>
							</button>
							<div class="faq-answer">
								<p>Yes. OneSpace includes built-in streaming handlers for videos, audio tracks, PDFs, code files, and photos. You can stream 4K media directly in your browser without waiting for the whole file to download locally.</p>
							</div>
						</div>

						<div class="faq-item glass-panel">
							<button type="button" class="faq-question">
								<span>Is OneSpace open-source and free to use?</span>
								<span class="faq-chevron">${icons.chevronDown}</span>
							</button>
							<div class="faq-answer">
								<p>Yes, OneSpace is 100% free and open-source. You can run it on your desktop, host it on a home server, or deploy it in your private Docker environment.</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- Final High-Impact CTA Banner -->
			<section class="landing-cta-banner">
				<div class="cta-banner-glow"></div>
				<div class="cta-banner-inner glass-panel">
					<div class="cta-banner-content">
						<h2 class="cta-banner-title">Ready to Unify Your Scattered Cloud Drives?</h2>
						<p class="cta-banner-sub">
							Join thousands of smart hoarders and creators consolidating their free cloud storage into one seamless operating system.
						</p>
						<div class="cta-banner-actions">
							<a href="${isLoggedIn ? '#home' : '#login'}" class="btn-cta-primary pulse-glow">
								${icons.zap}
								<span>${isLoggedIn ? 'Launch Free Workspace' : 'Sign in with Google to Launch'}</span>
							</a>
							${!isLoggedIn ? `
								<a href="#login" class="btn-cta-secondary">
									<svg class="google-svg" viewBox="0 0 24 24" width="18" height="18">
										<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
										<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
										<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
										<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
									</svg>
									<span>Sign in with Google</span>
								</a>
							` : ''}
						</div>
					</div>
				</div>
			</section>

			<!-- Modern SaaS Footer -->
			<footer class="landing-footer">
				<div class="landing-footer-inner">
					<div class="footer-brand-col">
						<a href="#landing" class="landing-brand">
							<img src="/src/assets/logo.webp" alt="OneSpace" class="landing-brand-logo" onerror="this.style.display='none'">
							<span class="landing-brand-name">OneSpace</span>
						</a>
						<p class="footer-tagline">
							The unified, high-performance virtual cloud filesystem that bridges Google Drive, MEGA, and Dropbox.
						</p>
						<div class="footer-status-indicator">
							<span class="status-pulse-dot"></span>
							<span>All Cloud Services Operational</span>
						</div>
					</div>

					<div class="footer-links-col">
						<span class="footer-col-title">Navigation</span>
						<a href="#landing-features">Features</a>
						<a href="#landing-calculator">Storage Calculator</a>
						<a href="#landing-how">How It Works</a>
						<a href="#landing-comparison">Comparison</a>
						<a href="#landing-faq">FAQ</a>
					</div>

					<div class="footer-links-col">
						<span class="footer-col-title">Workspace</span>
						<a href="${isLoggedIn ? '#home' : '#login'}">Storage Overview</a>
						<a href="${isLoggedIn ? '#drive' : '#login'}">My Drive Files</a>
						<a href="${isLoggedIn ? '#storage' : '#login'}">Linked Cloud Drives</a>
						<a href="#login">${isLoggedIn ? 'Switch Account' : 'Sign in with Google'}</a>
					</div>

					<div class="footer-links-col">
						<span class="footer-col-title">Security & Stack</span>
						<span>AES-256 Zero-Knowledge</span>
						<span>MongoDB Atlas Cloud Engine</span>
						<span>Google OAuth 2.0 PKCE</span>
						<span>Vite & Node.js</span>
					</div>
				</div>

				<div class="footer-bottom-bar">
					<p>© 2026 OneSpace Drive Aggregator by Chandan Raj. Open-source under MIT License.</p>
					<div class="footer-bottom-links">
						<a href="#landing">Privacy Policy</a>
						<a href="#landing">Terms of Service</a>
						<a href="${isLoggedIn ? '#home' : '#login'}">Direct Workspace Access</a>
					</div>
				</div>
			</footer>
		</div>
	`;

	// Initialize Interactive Elements
	initLandingEventListeners(container, { state, navigateTo, toggleTheme, showToast, isLoggedIn });
}

function initLandingEventListeners(container, { state, navigateTo, toggleTheme, showToast, isLoggedIn }) {
	// Intercept unauthenticated workspace access attempts
	if (!isLoggedIn) {
		const workspaceLinks = container.querySelectorAll('a[href^="#home"], a[href^="#drive"], a[href^="#storage"], a[href^="#quota"], a[href^="#settings"]');
		workspaceLinks.forEach((link) => {
			link.addEventListener('click', (e) => {
				e.preventDefault();
				if (showToast) {
					showToast('Please sign in with Google to access your OneSpace workspace.', 'info');
				}
				navigateTo('login');
			});
		});
	}

	// Theme toggle
	const themeBtn = container.querySelector('#landing-theme-toggle');
	if (themeBtn) {
		themeBtn.addEventListener('click', () => {
			toggleTheme();
			const icon = container.querySelector('#landing-theme-icon');
			if (icon) {
				icon.innerHTML = state.theme === 'dark' ? icons.sun : icons.moon;
			}
		});
	}

	// FAQ Accordions
	container.querySelectorAll('.faq-question').forEach((btn) => {
		btn.addEventListener('click', () => {
			const item = btn.closest('.faq-item');
			const isOpen = item.classList.contains('open');
			container.querySelectorAll('.faq-item').forEach((i) => i.classList.remove('open'));
			if (!isOpen) {
				item.classList.add('open');
			}
		});
	});

	// Interactive Simulator
	const uploadBtn = container.querySelector('#btn-simulate-upload');
	const uploadProgress = container.querySelector('#sim-upload-progress');
	const uploadFill = container.querySelector('#sim-upload-fill');
	const uploadPct = container.querySelector('#sim-upload-pct');
	const btnText = container.querySelector('#btn-simulate-upload-text');
	const poolUsed = container.querySelector('#sim-used-val');

	if (uploadBtn && uploadProgress && uploadFill && uploadPct) {
		let isSimulating = false;
		uploadBtn.addEventListener('click', () => {
			if (isSimulating) return;
			isSimulating = true;
			uploadBtn.disabled = true;
			uploadProgress.classList.remove('hidden');
			btnText.textContent = 'Allocating & Striping across 3 cloud providers...';

			let progress = 0;
			const interval = setInterval(() => {
				progress += 5;
				if (progress > 100) progress = 100;
				uploadFill.style.width = `${progress}%`;
				uploadPct.textContent = `${progress}%`;

				if (progress >= 100) {
					clearInterval(interval);
					btnText.textContent = '✓ Simulated 4.2 GB Upload Distributed Successfully!';
					if (poolUsed) poolUsed.textContent = '12.6 GB';
					setTimeout(() => {
						isSimulating = false;
						uploadBtn.disabled = false;
						btnText.textContent = 'Simulate Smart Multi-Cloud Upload (4.2 GB 4K Video)';
					}, 4000);
				}
			}, 90);
		});
	}

	// Interactive Calculator
	const sliderG = container.querySelector('#calc-slider-gdrive');
	const sliderM = container.querySelector('#calc-slider-mega');
	const sliderD = container.querySelector('#calc-slider-dropbox');

	const countG = container.querySelector('#calc-gdrive-count');
	const countM = container.querySelector('#calc-mega-count');
	const countD = container.querySelector('#calc-dropbox-count');

	const totalGb = container.querySelector('#calc-total-gb');
	const savings = container.querySelector('#calc-savings');

	const barG = container.querySelector('#calc-bar-gdrive');
	const barM = container.querySelector('#calc-bar-mega');
	const barD = container.querySelector('#calc-bar-dropbox');

	const legG = container.querySelector('#calc-legend-g');
	const legM = container.querySelector('#calc-legend-m');
	const legD = container.querySelector('#calc-legend-d');

	function updateCalculator() {
		const gVal = Number(sliderG?.value || 0);
		const mVal = Number(sliderM?.value || 0);
		const dVal = Number(sliderD?.value || 0);

		const gGB = gVal * 15;
		const mGB = mVal * 20;
		const dGB = dVal * 2;
		const total = gGB + mGB + dGB;

		if (countG) countG.textContent = `${gVal} account${gVal === 1 ? '' : 's'} (${gGB} GB)`;
		if (countM) countM.textContent = `${mVal} account${mVal === 1 ? '' : 's'} (${mGB} GB)`;
		if (countD) countD.textContent = `${dVal} account${dVal === 1 ? '' : 's'} (${dGB} GB)`;

		if (totalGb) totalGb.textContent = String(total);

		// Pricing savings calculation ($2.99 / 100GB / month baseline)
		const savedDollar = Math.max(12, Math.round((total / 100) * 2.99 * 12));
		if (savings) savings.textContent = `$${savedDollar}.00 / year`;

		if (total > 0) {
			const pctG = ((gGB / total) * 100).toFixed(1);
			const pctM = ((mGB / total) * 100).toFixed(1);
			const pctD = ((dGB / total) * 100).toFixed(1);

			if (barG) barG.style.width = `${pctG}%`;
			if (barM) barM.style.width = `${pctM}%`;
			if (barD) barD.style.width = `${pctD}%`;

			if (legG) legG.textContent = `Google: ${gGB} GB (${pctG}%)`;
			if (legM) legM.textContent = `MEGA: ${mGB} GB (${pctM}%)`;
			if (legD) legD.textContent = `Dropbox: ${dGB} GB (${pctD}%)`;
		} else {
			if (barG) barG.style.width = '0%';
			if (barM) barM.style.width = '0%';
			if (barD) barD.style.width = '0%';
		}
	}

	sliderG?.addEventListener('input', updateCalculator);
	sliderM?.addEventListener('input', updateCalculator);
	sliderD?.addEventListener('input', updateCalculator);

	// Presets
	container.querySelectorAll('.btn-calc-preset').forEach((btn) => {
		btn.addEventListener('click', () => {
			container.querySelectorAll('.btn-calc-preset').forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');
			if (sliderG) sliderG.value = btn.dataset.g;
			if (sliderM) sliderM.value = btn.dataset.m;
			if (sliderD) sliderD.value = btn.dataset.d;
			updateCalculator();
		});
	});

	// Initial calc run
	updateCalculator();
}
