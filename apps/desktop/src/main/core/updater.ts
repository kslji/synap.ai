/**
 * App updates (main process).
 * Online : electron-updater + GitHub Releases (public repo). electron-builder writes app-update.yml at
 *          build time - do NOT call setFeedURL. Windows NSIS updates work unsigned (SmartScreen warns);
 *          macOS auto-update REQUIRES a signed app, so unsigned Mac test builds update manually.
 * Offline: the user picks an installer from USB/LAN plus its .sig file. We verify our own Ed25519
 *          signature (same scheme as packs), then launch the installer and quit.
 */
import { app, dialog, shell, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater'; // CJS package: default import works in both CJS and ESM builds
import { readFile } from 'node:fs/promises';
import { verify as edVerify } from 'node:crypto';
import { ed25519PublicKey } from './pack-verify.js';

const { autoUpdater } = electronUpdater;

export function initAutoUpdate(win: BrowserWindow, isOfflineOnly: () => boolean): void {
  autoUpdater.autoDownload = false; //          ask before downloading ~150 MB
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', async (info) => {
    if (win.isDestroyed()) return
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Download', 'Later'], defaultId: 0,
      message: `Surf AI ${info.version} is available`, detail: 'Your chats and packs stay on this computer.',
    });
    if (response === 0) void autoUpdater.downloadUpdate();
  });
  autoUpdater.on('update-downloaded', async () => {
    if (win.isDestroyed()) return
    const { response } = await dialog.showMessageBox(win, { buttons: ['Restart now', 'On next launch'], message: 'Update ready' });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (e) => console.warn('[updater]', e.message)); // offline = just try later
  const check = () => { if (!isOfflineOnly() && app.isPackaged) void autoUpdater.checkForUpdates().catch(() => undefined); };
  setTimeout(check, 10_000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

/** RELEASE_PUBKEY_HEX is compiled into the app; the private key lives only in CI secrets. */
export async function installOfflineUpdate(win: BrowserWindow, releasePubkeyHex: string): Promise<boolean> {
  const ext = process.platform === 'win32' ? ['exe'] : ['dmg'];
  const pick = await dialog.showOpenDialog(win, { title: 'Choose Surf AI installer', filters: [{ name: 'Installer', extensions: ext }], properties: ['openFile'] });
  if (pick.canceled || !pick.filePaths[0]) return false;
  const file = pick.filePaths[0];
  const [bytes, sig] = await Promise.all([readFile(file), readFile(file + '.sig').catch(() => null)]);
  if (!sig || sig.length !== 64 || !edVerify(null, bytes, ed25519PublicKey(releasePubkeyHex), sig)) {
    await dialog.showMessageBox(win, { type: 'error', message: 'This installer is not signed by Surf AI. It was not opened.' });
    return false;
  }
  // Windows: run the NSIS installer (it closes the running app). macOS: open the dmg for drag-to-Applications.
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
  if (process.platform === 'win32') setTimeout(() => app.quit(), 1500);
  return true;
}
