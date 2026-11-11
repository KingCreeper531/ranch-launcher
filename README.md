# Ranch Launcher

One place to install, update and open the Ranch apps on Windows, Android and iPhone. It picks the right download for the device it runs on.

## The apps

Every app has a Windows installer (`.exe`), an Android app (`.apk`) and an iPhone/iPad app (`.ipa`), and updates itself.

| App | What it does |
|---|---|
| [YouTube Music](https://github.com/KingCreeper531/youtube-music-desktop) | YouTube Music with no ads and SponsorBlock for music videos. Shows what you're playing in Discord. **My Music** plays your own song files inside the app and can upload them to your YouTube Music library. Imports Spotify playlists. Has a free Song / Video switch and keeps playing in the background. |
| [YouTube](https://github.com/KingCreeper531/youtube-desktop) | YouTube with no ads, SponsorBlock (skips sponsors, with Undo) and dislike counts. Adds picture in picture and background play, and remembers your quality and speed. Can open videos in theater mode, hide Shorts and clean share links. Shows what you're watching in Discord. |
| [Ad Blocker](https://github.com/KingCreeper531/ranch-adblock) | One switch that blocks ads and trackers in every app and browser on the device, using AdGuard DNS or Mullvad DNS. No VPN, and nothing runs in the background. On iPhone it's a DNS profile you install. |
| [Facebook](https://github.com/KingCreeper531/facebook-desktop) | Facebook with no sponsored posts, Reels turned off, and no "Suggested for you", "People you may know" or Meta AI. Links open without Facebook's tracking. Windows notifications and an unread badge. |
| [Twitter](https://github.com/KingCreeper531/twitter-desktop) | Twitter (x.com) with no promoted posts, Grok or Premium upsells. **Classic 2018 layout** on Windows: the old top bar, Home with your profile card, old-style profiles, Tweets, notifications and Messages (blue and grey bubbles), plus the old "Log in to Twitter" page. Opens on Following, and links skip t.co. Windows notifications and an unread badge. |
| [Instagram](https://github.com/KingCreeper531/instagram-desktop) | Instagram with no sponsored posts and Reels turned off. Opens on your **Following** feed (people you follow, newest first) instead of suggestions, and hides "Suggested for you", Threads and Meta AI. Links open and copy without tracking. Windows notifications and an unread badge. |

## What the launcher does

- **Install and open apps.** Each app gets a page with its status, version, size and the release notes from GitHub.
- **Automatic updates.** New versions download as soon as they're released. If the app is closed, the update installs right away. If it's open, it installs the moment you close it, or straight away with **Update now**.
- **App settings.** On Windows, each app's **Settings** tab edits that app's own settings and stays in sync with the app: change something in either place and the other follows.
- **Updates itself.** On Windows and Android the launcher downloads its own new versions; on iPhone its Update button opens the download page.
- **Stays out of the way.** On Windows it runs in the tray and can start with Windows so updates keep coming.

## Download

Get the latest release from the [Releases page](https://github.com/KingCreeper531/ranch-launcher/releases/latest):

- `Ranch-Launcher-Setup-x.y.z.exe`: Windows.
- `Ranch-Launcher-Android-x.y.z.apk`: Android. Open it on your phone to install.
- `Ranch-Launcher-iOS-x.y.z.ipa`: iPhone and iPad. Install it with [AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io) using your Apple ID.

## Build from source

```bash
npm install
npm start        # builds the window UI and runs the launcher
npm run dist     # builds the Windows installer into dist/
npm run release  # Windows + Android, published to GitHub; GitHub then builds the iPhone app
```

The window UI is React (built with Vite) in `renderer/`; the Windows app logic is Electron in `src/`, the Android app is in `android/` and the iPhone app in `ios/`. Apps are listed in `src/catalog.json`.

## Credits

Animations and some interface pieces come from [React Bits](https://github.com/DavidHDev/react-bits) by David Haz, used under its license (see `renderer/src/react-bits/LICENSE.md`). They may be used as part of this app but not sold or redistributed on their own.
