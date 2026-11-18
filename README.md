# Student Tracker

A desktop app for language tutors to keep track of their students: level, needs, recurring mistakes, vocabulary, grammar, lesson count, documents and reports.

## Install (on the computer that will use the app)

1. Open **[Releases](https://github.com/K1Voodoo/student-tracker/releases/latest)**.
2. Download `Student-Tracker-Setup-x.y.z.exe` and run it.
   If Windows SmartScreen appears, click **More info → Run anyway** (the installer is not code-signed).

After that the app updates itself. It checks GitHub at startup and every 4 hours. When there is a new version it shows a banner with **Update now**. It downloads the update and then restarts.

Student data is stored only on that computer in `%APPDATA%\Student Tracker\data.json`. It is never uploaded. Use **Settings → Export backup** to keep a copy.

## Making changes and shipping an update

On the development computer (Node.js, Git and GitHub CLI installed and signed in):

```powershell
npm install          # first time only
npm start            # run the app locally to try your changes
.\release.ps1        # publish: 1.0.0 -> 1.0.1
.\release.ps1 minor  # publish: 1.0.1 -> 1.1.0
```

`release.ps1` commits your changes, raises the version and pushes a tag. GitHub Actions (`.github/workflows/release.yml`) then builds the installer and publishes the release, which takes about 5 minutes. You can follow it on the **Actions** tab. The installed app finds the new version automatically.

## Project layout

| Path | What it is |
|---|---|
| `src/main.js` | Main process: data storage, file dialogs, report scanning, auto-update |
| `src/preload.js` | Safe bridge between main process and UI |
| `src/renderer/` | UI (`index.html`, `styles.css`, `renderer.js`) |
| `release.ps1` | One-command release script |
| `.github/workflows/release.yml` | Builds and publishes the installer on GitHub |
