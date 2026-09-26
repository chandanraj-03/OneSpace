import { Router } from 'express';
import { requireAppUser } from '../middleware/authMiddleware.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

const router = Router();

router.use(requireAppUser);

router.get('/settings', (req, res) => {
	try {
		const settings = getSettings(req.user.id);
		res.json({ data: settings });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

router.patch('/settings', (req, res) => {
	try {
		const settings = req.body;
		const updated = updateSettings(req.user.id, settings);
		res.json({ data: updated });
	} catch (error) {
		res.status(400).json({ error: error.message });
	}
});

export default router;
