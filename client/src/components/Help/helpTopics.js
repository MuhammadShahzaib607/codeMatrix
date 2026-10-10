export const HELP_TOPICS = [
  {
    id: 'freebuff',
    label: 'Freebuff',
    intro:
      'freebuff is a free CLI coding agent you run from the Terminal tab of this editor.',
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
]
