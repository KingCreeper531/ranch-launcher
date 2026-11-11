# Ranch Launcher

A Windows launcher that installs, updates and opens Ranch apps from one place. Right now that's [YouTube Music](https://github.com/KingCreeper531/youtube-music-desktop), with a YouTube app on the way.

## What it does

- **Install and open apps.** Each app gets a page with its status, version, size and the release notes from GitHub.
- **Automatic updates.** New versions download as soon as they're released. If the app is closed, the update installs right away. If it's open, it installs the moment you close it, or straight away with **Update now**.
- **App settings.** Each app's **Settings** tab edits that app's own settings, and stays in sync with the app: change something in either place and the other follows.
- **Stays out of the way.** Runs in the tray and can start with Windows so updates keep coming.

## Build from source

```bash
npm install
npm start        # builds the window UI and runs the launcher
npm run dist     # builds the Windows installer into dist/
```

The window UI is React (built with Vite) in `renderer/`; the app logic is Electron in `src/`. Apps are listed in `src/catalog.json`.

## Credits

Animations and some interface pieces come from [React Bits](https://github.com/DavidHDev/react-bits) by David Haz, used under its license (see `renderer/src/react-bits/LICENSE.md`). They may be used as part of this app but not sold or redistributed on their own.
