import { Router } from 'express';
import { deleteAccount, getAccountById, listAccounts } from '../services/accountService.js';
import { env } from '../config/env.js';
import { requireAppUser } from '../middleware/authMiddleware.js';
import {
	createGoogleAuthorizationRequest,
	completeGoogleAccountLink,
	createGooglePhotosAuthorizationRequest,
	completeGooglePhotosAccountLink,
	getGoogleIntegrationStatus,
	getOAuthState,
	completeGoogleLogin,
} from '../services/googleOAuthService.js';
import {
	createDropboxAuthorizationRequest,
	completeDropboxAccountLink,
	getDropboxIntegrationStatus,
} from '../services/dropboxOAuthService.js';
import { connectMegaAccount, getMegaIntegrationStatus } from '../services/megaAccountService.js';
import { clearFilesForAccount } from '../services/fileService.js';

const router = Router();

// Public OAuth callbacks (must not require prior authentication)
router.get('/accounts/google/callback', async (req, res) => {
	const frontendUrl = new URL(env.frontendUrl);
	frontendUrl.pathname = '/';

	const { code, state, error } = req.query;
	const authState = getOAuthState(String(state || ''));

	try {
		if (error) {
			frontendUrl.hash = authState?.type === 'login' ? '#login' : '#storage';
			frontendUrl.searchParams.set('error', String(error));
			return res.redirect(frontendUrl.toString());
		}

		// Check if this was a user sign-in flow
		if (authState?.type === 'login') {
			const { session } = await completeGoogleLogin({ code: String(code || ''), state: String(state || '') });
			const options = res.locals.authCookieOptions || {};
			res.cookie(env.authCookieName, session.token, options);
			frontendUrl.hash = '#home';
			return res.redirect(frontendUrl.toString());
		}

		// Check if this was a Google Photos account link
		if (authState?.provider === 'google_photos') {
			frontendUrl.hash = '#storage';
			await completeGooglePhotosAccountLink({ code: String(code || ''), state: String(state || '') });
			frontendUrl.searchParams.set('google_photos', 'connected');
			return res.redirect(frontendUrl.toString());
		}

		// Otherwise, standard Google Drive account link
		frontendUrl.hash = '#storage';
		await completeGoogleAccountLink({ code: String(code || ''), state: String(state || '') });
		frontendUrl.searchParams.set('google', 'connected');
		return res.redirect(frontendUrl.toString());
	} catch (err) {
		frontendUrl.hash = authState?.type === 'login' ? '#login' : '#storage';
		frontendUrl.searchParams.set('error', err.message);
		return res.redirect(frontendUrl.toString());
	}
});

router.get('/accounts/dropbox/callback', async (req, res) => {
	const frontendUrl = new URL(env.frontendUrl);
	frontendUrl.pathname = '/';
	frontendUrl.hash = '#storage';

	try {
		const { code, state, error, error_description } = req.query;

		if (error) {
			frontendUrl.searchParams.set('error', String(error_description || error));
			return res.redirect(frontendUrl.toString());
		}

		await completeDropboxAccountLink({ code: String(code || ''), state: String(state || '') });
		frontendUrl.searchParams.set('dropbox', 'connected');
		return res.redirect(frontendUrl.toString());
	} catch (err) {
		frontendUrl.searchParams.set('error', err.message);
		return res.redirect(frontendUrl.toString());
	}
});

router.use(requireAppUser);

router.get('/accounts', (req, res) => {
	const accounts = listAccounts(req.user.id).map((account) => ({
		...account,
		free_space: Number(account.total_space) - Number(account.used_space),
	}));

	res.json({ data: accounts });
});

router.get('/accounts/google/status', (_req, res) => {
	res.json({ data: getGoogleIntegrationStatus() });
});

router.get('/accounts/dropbox/status', (_req, res) => {
	res.json({ data: getDropboxIntegrationStatus() });
});

router.get('/accounts/mega/status', (_req, res) => {
	res.json({ data: getMegaIntegrationStatus() });
});

router.get('/accounts/google/connect', (req, res, next) => {
	try {
		const data = createGoogleAuthorizationRequest(req.user.id);
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.get('/accounts/google-photos/connect', (req, res, next) => {
	try {
		const data = createGooglePhotosAuthorizationRequest(req.user.id);
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.get('/accounts/dropbox/connect', (req, res, next) => {
	try {
		const data = createDropboxAuthorizationRequest(req.user.id);
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.post('/accounts/mega/connect', async (req, res, next) => {
	try {
		const data = await connectMegaAccount(req.user.id, req.body || {});
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.delete('/accounts/:id', (req, res) => {
	const account = getAccountById(req.user.id, req.params.id);
	if (!account) {
		return res.status(404).json({ error: 'Account not found' });
	}

	clearFilesForAccount(req.user.id, account.id);
	deleteAccount(req.user.id, account.id);

	return res.json({ data: { success: true } });
});

export default router;
