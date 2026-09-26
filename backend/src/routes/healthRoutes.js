import { Router } from 'express';
import { redactEnv } from '../config/env.js';
import { getAuthSummary } from '../services/authService.js';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { getLastSyncReport, runDeltaSync } from '../services/syncService.js';

const router = Router();

router.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		service: 'onespace-api',
		config: redactEnv(),
		auth: getAuthSummary(req.user),
		sync: getLastSyncReport(),
		timestamp: new Date().toISOString(),
	});
});

router.post('/sync/run', requireAppUser, async (req, res, next) => {
	try {
		const report = await runDeltaSync(req.user.id);
		res.json({ data: report });
	} catch (error) {
		next(error);
	}
});

export default router;
