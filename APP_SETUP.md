# My Job Tracker: installation and setup

This guide installs and runs the local My Job Tracker web app on Windows, macOS,
or Linux. The app runs on your computer and listens only on `127.0.0.1` by default.
Your uploaded resume, profile, tracked jobs, and generated application files stay
in local, Git-ignored folders.

## Requirements at a glance

| Requirement | Needed for | Windows | macOS | Linux |
| --- | --- | --- | --- | --- |
| Git | Clone or update the repository | Git for Windows | Xcode Command Line Tools or Git | `git` package |
| Bun | Run the server and job search CLI | Bun for Windows 10 1809+ | Bun on macOS 13+ | Bun and `unzip` |
| LaTeX with LuaLaTeX and XeLaTeX | Compile tailored resumes and cover letters to PDF | MiKTeX | MacTeX / TeX Live | TeX Live |
| API credentials | Optional extra job sources | Adzuna / Jooble | Adzuna / Jooble | Adzuna / Jooble |

Python, Node.js, npm packages, a database server, and a separate web server are
not required to run this app. The bundled FreeHire search CLI has no runtime
package dependencies. Other framework tools described in `SETUP.md` may have
additional requirements; they are not prerequisites for this web app.

## 1. Install prerequisites

### Windows

1. Install Git for Windows from [git-scm.com](https://git-scm.com/download/win).
2. Open PowerShell and install Bun:

   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Open a new PowerShell window and confirm `bun --version` works. Bun requires
   Windows 10 version 1809 or newer.

3. Install MiKTeX from [miktex.org/download](https://miktex.org/download). In
   MiKTeX Console, allow automatic installation of missing packages. For a
   per-user install, you can enable this from PowerShell with:

   ```powershell
   initexmf --set-config-value=[MPM]AutoInstall=1
   ```

   Confirm both engines are on `PATH`:

   ```powershell
   Get-Command lualatex, xelatex
   ```

### macOS

1. Install Git and Apple's command-line tools:

   ```bash
   xcode-select --install
   ```

2. Install Bun in Terminal:

   ```bash
   curl -fsSL https://bun.com/install | bash
   ```

   Close and reopen Terminal, then confirm `bun --version` works. Bun requires
   macOS 13 or newer.

3. Install the full MacTeX distribution from [tug.org/mactex](https://tug.org/mactex/).
   If you already use Homebrew, the smaller GUI-free option is:

   ```bash
   brew install --cask mactex-no-gui
   ```

   Open a new Terminal window and confirm `command -v lualatex` and
   `command -v xelatex` each return a path.

### Linux (Debian / Ubuntu)

1. Install Git, curl, unzip, and TeX Live:

   ```bash
   sudo apt update
   sudo apt install -y git curl unzip texlive-full
   ```

   `texlive-full` is a large download, but includes the packages needed by the
   bundled resume and cover-letter templates. Other Linux distributions should
   install Git, `curl`, `unzip`, and a full TeX Live distribution using their
   package manager.

2. Install Bun:

   ```bash
   curl -fsSL https://bun.com/install | bash
   ```

   Start a new shell (or load `~/.bashrc` / `~/.zshrc`) and confirm `bun --version`
   works. Confirm the TeX engines are available with `command -v lualatex` and
   `command -v xelatex`.

## 2. Get the project

If you are setting up your own copy hosted on GitHub:

```bash
git clone <your-repository-url>
cd ai-job-search
```

If you already have the project, open a terminal in the repository root—the
folder containing `tools/`, `app/`, `cv/`, and `cover_letters/`.

No `bun install` step is required to run the web app. The FreeHire CLI is
self-contained and has no runtime dependencies.

## 3. Optional job-source API credentials

FreeHire search works without API keys. Adzuna can add India city results when
both Adzuna credentials are configured. Jooble can be configured for the
regional endpoint(s) for which you have credentials.

Create a `.env.local` file in the repository root. Bun loads this file when the
app starts. Keep real credentials private; never add them to source code,
screenshots, or a public repository. The repository's `.gitignore` excludes
`.env.local`.

Example with placeholders (replace them locally):

```dotenv
ADZUNA_APP_ID=your_adzuna_app_id
ADZUNA_APP_KEY=your_adzuna_app_key
JOOBLE_APIS='[{"name":"Jooble India","baseUrl":"https://in.jooble.org/api","apiKey":"your_jooble_key","country":"India"}]'
```

Leave out any provider's lines if you do not use that source. Restart the app
after editing `.env.local` so the new settings are loaded. API availability,
coverage, and request quotas are set by each provider.

## 4. Start the app

Run the server from the repository root.

**Windows PowerShell:**

```powershell
bun run tools\job-tracker-app.ts
```

**macOS / Linux:**

```bash
bun run tools/job-tracker-app.ts
```

When the terminal reports that the tracker is running, open
[http://127.0.0.1:4177](http://127.0.0.1:4177) in a browser. Leave the terminal
open while using the app. Press `Ctrl+C` in that terminal to stop it.

## 5. First use

1. Open **My Profile** and upload a `.docx`, `.txt`, or `.md` resume. Review the
   extracted text and save the profile.
2. Open **Search Jobs**, enter a role and location, and search. Each result shows
   the job source where available. Track roles you want to follow.
3. Open **Application Tracker** to update status and notes. Prepare tailored
   resume and cover-letter documents from a tracked posting, then review them.
4. Apply on the employer's site. The app does not submit external application
   forms. Update the job status after you apply or receive a response.

## Local files and privacy

- `data/candidate-profile.json` and `data/resume-source` store the local profile
  and uploaded resume text.
- `data/job-tracker.json` stores tracked listings, statuses, and notes.
- `documents/applications/` stores generated LaTeX sources and PDFs.
- `.env.local` stores optional API credentials.

These paths are ignored by Git. Back them up securely if you need to move your
tracker to another computer. Do not commit or publish candidate information or
API keys.

## Troubleshooting

### `bun` is not recognized / `command not found`

Finish Bun's installer, open a new terminal window, and run `bun --version`. On
macOS and Linux, ensure `~/.bun/bin` is on `PATH`. On Windows, ensure Bun's
installation directory is on `PATH`.

### Port 4177 is already in use

Stop the existing tracker process with `Ctrl+C`, or start this copy on another
port. For PowerShell:

```powershell
$env:PORT = "4178"
bun run tools\job-tracker-app.ts
```

For macOS/Linux:

```bash
PORT=4178 bun run tools/job-tracker-app.ts
```

Then open `http://127.0.0.1:4178`.

### PDF generation says `lualatex` or `xelatex` was not found

Install the LaTeX distribution for your operating system, confirm both commands
are on `PATH`, and restart the terminal and app. Resume compilation uses
LuaLaTeX; cover-letter compilation uses XeLaTeX.

### A TeX package is missing

On MiKTeX, allow the package manager to install missing packages. On macOS and
Linux, use the full TeX distribution recommended above, then update the TeX
package database with the distribution's package manager.

### A job source is absent or reports an error

FreeHire requires an internet connection. Adzuna requires both credentials and
currently applies to India city searches in this app. Jooble requires a valid
endpoint/key configuration for that search market. Check the provider's account
quota and service status; the other configured providers can still return
results when one source is unavailable.

## Official installation references

- [Bun installation](https://bun.com/docs/installation)
- [Bun environment variables and `.env` loading](https://bun.sh/docs/runtime/environment-variables)
- [MiKTeX downloads](https://miktex.org/download)
- [MiKTeX installation manual](https://docs.miktex.org/manual/installing.html)
- [MacTeX](https://tug.org/mactex/)
- [TeX Live](https://tug.org/texlive/)
