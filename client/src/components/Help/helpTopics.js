export const HELP_TOPICS = [
  {
    id: 'freebuff',
    label: 'Freebuff',
    intro:
      'freebuff is a free CLI coding agent you run from the Terminal tab of this editor. Before you close the editor, keep a copy of your work — see the "Save your work" topic in this Help window.',
    sections: [
      {
        id: 'what-it-is',
        title: 'What it is',
        body: ['freebuff is an external CLI coding agent you run inside the Terminal tab.'],
      },
      {
        id: 'quick-start',
        title: 'Quick start (recommended)',
        body: [
          'It must be run inside the folder you want it to work in, so move into that folder first, then install it and start it:',
        ],
        commands: ['cd folder-name', 'npm i freebuff', 'npx freebuff'],
      },
      {
        id: 'global-install',
        title: 'Global install',
        body: [
          '`npm install -g freebuff` is not possible on the hosted server: the account has no root permission and the install fails with `EACCES`. If the hosted server already provides freebuff on `PATH`, just type `freebuff`. On your own computer a global install works.',
        ],
        commands: ['npm install -g freebuff', 'freebuff'],
      },
      {
        id: 'login',
        title: 'Login',
        body: [
          'freebuff prints a URL. Copy it — select it and press `Ctrl+C`, or click the link — and open it in your own browser. The terminal waits until the login finishes.',
        ],
      },
      {
        id: 'copy-paste',
        title: 'Copy and paste in the terminal',
        items: [
          { text: 'Select text and press `Ctrl+C` to copy it.' },
          { text: 'With no selection, `Ctrl+C` stops the running program (interrupt).' },
          { text: '`Ctrl+Shift+C` copies and `Ctrl+Shift+V` pastes.' },
          { text: 'Hold `Shift` while selecting if a program captures the mouse.' },
        ],
      },
      {
        id: 'common-problems',
        title: 'Common problems with fixes',
        items: [
          {
            text: '`command not found` — freebuff is not installed for this shell. Use `npx freebuff`, or install it first.',
            commands: ['npm i freebuff', 'npx freebuff'],
          },
          {
            text: '`EACCES` permission denied — do not use `-g` on the hosted server, use a local install instead.',
            commands: ['npm i freebuff', 'npx freebuff'],
          },
          {
            text: 'freebuff keeps asking you to log in — the hosted server disk resets, so log in again.',
          },
          {
            text: 'Nothing happens when you press keys — click inside the terminal first so it has focus.',
          },
          {
            text: 'Files created by freebuff appear in the Explorer automatically.',
          },
        ],
      },
      {
        id: 'temporary-storage',
        title: 'Temporary storage',
        body: [
          'On the hosted free tier the server disk is temporary: export your work regularly.',
        ],
      },
    ],
  },
  {
    id: 'save-your-work',
    label: 'Save your work',
    intro:
      'On the hosted free tier the server disk is temporary. Projects can disappear when the server restarts or sleeps, so always keep your own copy before you close or leave the editor.',
    sections: [
      {
        id: 'why',
        title: 'Why you must keep a copy',
        body: [
          'The files you see in the editor live on the hosted server, and that disk is temporary. When the server restarts or sleeps, the projects on it can be lost.',
          'Your work in the browser is not saved anywhere else. There is no online backup, and closing the tab does not keep it.',
          'Keep a copy of anything you care about before you close the editor or leave for a while. Use any of the options below.',
        ],
      },
      {
        id: 'export-zip',
        title: '1. Export as ZIP',
        body: [
          'In the Topbar, click Export ZIP. A .zip file downloads to your computer — keep that file somewhere safe.',
        ],
      },
      {
        id: 'export-folder',
        title: '2. Export to Folder or Sync to Laptop',
        body: [
          'These write the project files straight to your computer. Export to folder writes a copy into a folder you pick. Sync to laptop updates the folder you imported from.',
          'Use either one whenever you want your latest files on your own machine.',
        ],
      },
      {
        id: 'git',
        title: '3. Push to your own repository (git)',
        body: [
          'Open the Terminal tab and run these commands inside your project folder. Replace the URL with the address of your own empty repository on GitHub, GitLab or any other git host.',
        ],
        commands: [
          'git init',
          'git add .',
          'git commit -m "save"',
          'git remote add origin <your-repo-url>',
          'git push -u origin main',
        ],
      },
      {
        id: 'git-login',
        title: 'Git login',
        body: [
          'Pushing needs you to sign in to your git host. Use your account login, or a personal access token as the password if your host asks for one.',
        ],
      },
      {
        id: 'clone-later',
        title: '4. Come back to it later',
        body: [
          'To continue on another computer, or after the server has been reset, clone your repository and open the project again:',
        ],
        commands: ['git clone <your-repo-url>'],
      },
    ],
  },
  {
    id: 'install-app',
    label: 'Install as app',
    intro:
      'You can install CodeMatrix as an app. It then opens in its own window without the browser address bar, like a normal desktop or mobile app.',
    sections: [
      {
        id: 'chrome-edge',
        title: 'Chrome and Edge (desktop)',
        items: [
          { text: 'Open CodeMatrix in Chrome or Edge.' },
          { text: 'Click the install icon in the address bar — a small monitor with a downward arrow (Edge) or a plus (Chrome).' },
          { text: 'Click Install to confirm. CodeMatrix opens in its own window.' },
          { text: 'If you do not see the icon, open the browser menu and choose Install CodeMatrix.' },
          { text: 'Once installed you can open it from the Start menu, the dock, or the app list.' },
        ],
      },
      {
        id: 'ios',
        title: 'Safari on iPhone and iPad',
        body: [
          'Open CodeMatrix in Safari, tap the Share button, then choose Add to Home Screen. The app icon appears on your home screen.',
        ],
      },
    ],
  },
]
