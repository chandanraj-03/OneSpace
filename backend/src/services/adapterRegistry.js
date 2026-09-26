import { GoogleDriveAdapter } from '../adapters/GoogleDriveAdapter.js';
import { GooglePhotosAdapter } from '../adapters/GooglePhotosAdapter.js';
import { DropboxAdapter } from '../adapters/DropboxAdapter.js';
import { MegaAdapter } from '../adapters/MegaAdapter.js';

const adapters = {
	google_drive: GoogleDriveAdapter,
	google_photos: GooglePhotosAdapter,
	dropbox: DropboxAdapter,
	mega: MegaAdapter,
};

export function createAdapter(account) {
	const Adapter = adapters[account.provider];

	if (!Adapter) {
		throw new Error(`Unsupported provider: ${account.provider}`);
	}

	return new Adapter(account);
}
