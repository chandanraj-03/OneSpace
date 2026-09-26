import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { env } from '../config/env.js';
import { upsertCloudAccount } from './accountService.js';
import { syncAccount } from './syncService.js';
import { getUserByEmail, createUser } from './userService.js';
import { createSession } from './authService.js';

const oauthStates = new Map();


function readGoogleCredentials() {
	if (!env.googleClientId || !env.googleClientSecret) {
		throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env');
	}

	return {
		client_id: env.googleClientId,
		client_secret: env.googleClientSecret,
	};
}

function createOAuthClient() {
	const config = readGoogleCredentials();
	return new google.auth.OAuth2(config.client_id, config.client_secret, env.googleRedirectUri);
}

async function fetchDriveProfile(oauthClient) {
	const drive = google.drive({ version: 'v3', auth: oauthClient });
	const about = await drive.about.get({
		fields: 'user(emailAddress,displayName),storageQuota(limit,usage)',
	});

	const user = about.data.user || {};
	const quota = about.data.storageQuota || {};

	return {
		email: user.emailAddress,
		displayName: user.displayName,
		totalSpace: Number(quota.limit || 0),
		usedSpace: Number(quota.usage || 0),
	};
}

export function getGoogleIntegrationStatus() {
	return {
		configured: Boolean(env.googleClientId && env.googleClientSecret),
		redirectUri: env.googleRedirectUri,
	};
}

export function createGoogleAuthorizationRequest(userId) {
	const oauthClient = createOAuthClient();
	const state = randomUUID();
	oauthStates.set(state, { userId, createdAt: Date.now() });

	const authorizationUrl = oauthClient.generateAuthUrl({
		access_type: 'offline',
		prompt: 'consent',
		scope: [
			'openid',
			'email',
			'profile',
			'https://www.googleapis.com/auth/drive',
			'https://www.googleapis.com/auth/drive.metadata',
		],
		state,
	});

	return {
		authorizationUrl,
		state,
		redirectUri: env.googleRedirectUri,
	};
}

export async function completeGoogleAccountLink({ code, state }) {
	if (!code || !state) {
		throw new Error('Missing Google OAuth code or state');
	}

	const authState = oauthStates.get(state);
	if (!authState) {
		throw new Error('Invalid or expired Google OAuth state');
	}

	oauthStates.delete(state);

	const oauthClient = createOAuthClient();
	const { tokens } = await oauthClient.getToken(code);
	oauthClient.setCredentials(tokens);

	const profile = await fetchDriveProfile(oauthClient);
	if (!profile.email) {
		throw new Error('Unable to read Google account email');
	}

	const account = upsertCloudAccount({
		userId: authState.userId,
		id: randomUUID(),
		email: profile.email,
		provider: 'google_drive',
		credentials: {
			provider: 'google_drive',
			clientId: oauthClient._clientId,
			clientSecret: oauthClient._clientSecret,
			redirectUri: env.googleRedirectUri,
			refreshToken: tokens.refresh_token || null,
			accessToken: tokens.access_token || null,
			expiryDate: tokens.expiry_date || null,
			scope: tokens.scope || null,
			tokenType: tokens.token_type || null,
		},
		total_space: profile.totalSpace,
		used_space: profile.usedSpace,
		status: 'active',
	});

	try {
		await syncAccount(authState.userId, account);
	} catch (syncErr) {
		console.warn('Initial sync warning on Google account link:', syncErr.message);
	}

	return {
		account,
		profile,
	};
}

export function getOAuthState(state) {
	return oauthStates.get(state);
}

export function createGoogleLoginAuthorizationRequest() {
	const oauthClient = createOAuthClient();
	const state = randomUUID();
	oauthStates.set(state, { type: 'login', createdAt: Date.now() });

	const authorizationUrl = oauthClient.generateAuthUrl({
		access_type: 'offline',
		prompt: 'select_account',
		scope: [
			'openid',
			'email',
			'profile',
		],
		state,
	});

	return {
		authorizationUrl,
		state,
		redirectUri: env.googleRedirectUri,
	};
}

export async function completeGoogleLogin({ code, state }) {
	if (!code || !state) {
		throw new Error('Missing Google OAuth code or state');
	}

	const authState = oauthStates.get(state);
	if (!authState || authState.type !== 'login') {
		throw new Error('Invalid or expired Google OAuth state');
	}

	oauthStates.delete(state);

	const oauthClient = createOAuthClient();
	const { tokens } = await oauthClient.getToken(code);
	oauthClient.setCredentials(tokens);

	const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
	const userInfo = await oauth2.userinfo.get();
	const email = (userInfo?.data?.email || '').toLowerCase().trim();

	if (!email) {
		throw new Error('Unable to read email from Google profile');
	}

	let user = getUserByEmail(email);
	if (!user) {
		user = createUser({
			email,
			passwordHash: '',
			isLocal: false,
		});
	}

	const session = createSession(user.id);
	return { user, session };
}

export function createGooglePhotosAuthorizationRequest(userId) {
	const oauthClient = createOAuthClient();
	const state = randomUUID();
	oauthStates.set(state, { userId, provider: 'google_photos', createdAt: Date.now() });

	const authorizationUrl = oauthClient.generateAuthUrl({
		access_type: 'offline',
		prompt: 'consent',
		scope: [
			'openid',
			'email',
			'profile',
			'https://www.googleapis.com/auth/photoslibrary.readonly',
		],
		state,
	});

	return {
		authorizationUrl,
		state,
		redirectUri: env.googleRedirectUri,
	};
}

export async function completeGooglePhotosAccountLink({ code, state }) {
	if (!code || !state) {
		throw new Error('Missing Google OAuth code or state');
	}

	const authState = oauthStates.get(state);
	if (!authState) {
		throw new Error('Invalid or expired Google OAuth state');
	}

	oauthStates.delete(state);

	const oauthClient = createOAuthClient();
	const { tokens } = await oauthClient.getToken(code);
	oauthClient.setCredentials(tokens);

	const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
	const userInfo = await oauth2.userinfo.get();
	const email = (userInfo?.data?.email || '').toLowerCase().trim();

	if (!email) {
		throw new Error('Unable to read Google account email');
	}

	const account = upsertCloudAccount({
		userId: authState.userId,
		id: randomUUID(),
		email,
		provider: 'google_photos',
		credentials: {
			provider: 'google_photos',
			clientId: oauthClient._clientId,
			clientSecret: oauthClient._clientSecret,
			redirectUri: env.googleRedirectUri,
			refreshToken: tokens.refresh_token || null,
			accessToken: tokens.access_token || null,
			expiryDate: tokens.expiry_date || null,
			scope: tokens.scope || null,
			tokenType: tokens.token_type || null,
		},
		total_space: 15 * 1024 * 1024 * 1024,
		used_space: 0,
		status: 'active',
	});

	try {
		await syncAccount(authState.userId, account);
	} catch (syncErr) {
		console.warn('Initial sync warning on Google Photos account link:', syncErr.message);
	}

	return { account, email };
}


