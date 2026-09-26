import { Router } from 'express';
import { env } from '../config/env.js';
import {
	destroySession,
	getAuthSummary,
} from '../services/authService.js';
import {
	createGoogleLoginAuthorizationRequest,
	completeGoogleLogin,
} from '../services/googleOAuthService.js';

const router = Router();

function setAuthCookie(res, token) {
	const options = res.locals.authCookieOptions || {};
	res.cookie(env.authCookieName, token, options);
}

function clearAuthCookie(res) {
	const options = res.locals.authCookieOptions || {};
	res.clearCookie(env.authCookieName, { ...options, maxAge: 0 });
}

router.get('/auth/me', (req, res) => {
	res.json({ data: getAuthSummary(req.user) });
});

router.post('/auth/register', (_req, res) => {
	res.status(403).json({
		error: 'Email and password registration is disabled to prevent fake accounts and spam sign-ups. Please sign up or sign in using Google.',
	});
});

router.post('/auth/login', (_req, res) => {
	res.status(403).json({
		error: 'Email and password authentication is disabled. Please sign in using Google.',
	});
});

router.post('/auth/logout', (req, res) => {
	const cookieHeader = req.headers.cookie || '';
	const token = cookieHeader
		.split(';')
		.map((item) => item.trim())
		.find((item) => item.startsWith(`${env.authCookieName}=`))
		?.slice(env.authCookieName.length + 1);

	if (token) {
		destroySession(decodeURIComponent(token));
	}

	clearAuthCookie(res);
	res.json({ data: getAuthSummary(env.appMode === 'local' ? req.user : null) });
});

router.get('/auth/google/url', (_req, res, next) => {
	try {
		const data = createGoogleLoginAuthorizationRequest();
		res.json({ data });
	} catch (error) {
		next(error);
	}
});

router.get('/auth/google', (_req, res, next) => {
	try {
		const data = createGoogleLoginAuthorizationRequest();
		res.redirect(data.authorizationUrl);
	} catch (error) {
		next(error);
	}
});

router.get('/auth/google/callback', async (req, res) => {
	const frontendUrl = new URL(env.frontendUrl);

	try {
		const { code, state, error } = req.query;

		if (error) {
			frontendUrl.hash = '#login';
			frontendUrl.searchParams.set('error', String(error));
			return res.redirect(frontendUrl.toString());
		}

		const { session } = await completeGoogleLogin({ code: String(code || ''), state: String(state || '') });
		setAuthCookie(res, session.token);
		frontendUrl.hash = '#home';
		return res.redirect(frontendUrl.toString());
	} catch (err) {
		frontendUrl.hash = '#login';
		frontendUrl.searchParams.set('error', err.message);
		return res.redirect(frontendUrl.toString());
	}
});

export default router;