# Aloft plugins

Aloft's own modules, built as Paseo directory plugins so upstream merges stay clean. Each folder is
one plugin with its own `paseo-plugin.json`, `package.json`, and `node_modules`.

| Plugin            | What it adds                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| [`notes`](notes/) | Markdown notes: a vault folder, daily notes, `[[links]]`, tags, search, quick capture, agent tools |

## Install into a daemon

Directory plugins load only when the daemon's `pluginsEnabled` is `true`. Install the folder once;
the daemon compiles it on load and keeps the path, so later edits only need a reload.

```bash
cd aloft-plugins/notes && npm install          # CodeMirror and friends, bundled into the plugin
npm run cli -- plugin install "$PWD"           # dev daemon (port 6768, .dev/paseo-home)
npm run cli -- plugin reload notes             # after editing the plugin source
npm run cli -- plugin logs notes               # server-side output and load errors
```

Use `paseo plugin install` against the packaged app's daemon (port 6767) for daily use.

## Check a change

```bash
(cd aloft-plugins/notes && ../../node_modules/.bin/tsgo -p tsconfig.json --noEmit)
npm run lint -- aloft-plugins/notes
npx vitest run aloft-plugins/notes --bail=1
```

The browser spec drives the real app against an isolated daemon. Point the vault at a scratch
folder so the run never touches your notes:

```bash
cd packages/app
ALOFT_NOTES_DEFAULT_VAULT=/tmp/notes-e2e npx playwright test --project=browser e2e/browser/aloft-notes.spec.ts
```

`ALOFT_NOTES_DEFAULT_VAULT` replaces the default vault folder (`~/Documents/Aloft Notes`) for any
daemon started with it. A folder picked in Settings still wins.

## Constraints that shape the code

- Client code runs on iOS, Android and web. It may bundle pure JavaScript packages, but it cannot
  load native modules beyond `react`, `react-native`, `@tanstack/react-query`, `zod` and the Paseo
  SDK. The CodeMirror editor therefore mounts only on web (`client/codemirror.ts`); the phone gets
  a plain text editor and the host Markdown renderer.
- The repo's lint rules apply here: memoise styles and callbacks rather than passing new objects or
  functions as props.
- The app shortcuts Cmd+B, Cmd+K and Cmd+N fire even inside text fields, so the editor binds none
  of them.
- Agent tools reach an agent only while the host's **Enable Paseo tools** switch is on
  (Settings, your host, Agents; `daemon.mcp.injectIntoAgents`). It is off by default. Start or
  reload an agent after turning it on.
